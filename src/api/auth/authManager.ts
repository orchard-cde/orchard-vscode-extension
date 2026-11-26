import * as vscode from 'vscode';
import { AuthMode, AuthProvider, UnauthorizedReport } from './authProvider';
import { FenceClient, FenceEndpoints, FenceError } from './fenceClient';
import { SessionStore, StoredSession, normalizeServerUrl } from './sessionStore';
import * as logger from '../../util/logger';

const REFRESH_SKEW_SECONDS = 30;
const MODE_RETRY_SECONDS = 60;
const CONFIG_TIMEOUT_MS = 10_000;

export interface SessionChange {
  added?: StoredSession;
  removed?: StoredSession;
}

export interface AuthManagerOptions {
  serverUrl: string;
  store: SessionStore;
  fence: FenceClient;
  fetchImpl?: typeof fetch;
  mock?: boolean;
  /** Current time in epoch seconds. */
  now?: () => number;
}

type AuthHeaders = Record<string, string>;

function bearer(session: StoredSession): AuthHeaders {
  return { Authorization: `Bearer ${session.accessToken}` };
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class AuthManager implements AuthProvider, vscode.Disposable {
  readonly serverUrl: string;

  private readonly _onDidChangeSession = new vscode.EventEmitter<SessionChange>();
  readonly onDidChangeSession = this._onDidChangeSession.event;
  private readonly _onDidChangeAuthentication = new vscode.EventEmitter<void>();
  readonly onDidChangeAuthentication = this._onDidChangeAuthentication.event;
  private readonly _onDidRequireSignIn = new vscode.EventEmitter<void>();
  readonly onDidRequireSignIn = this._onDidRequireSignIn.event;

  private readonly store: SessionStore;
  private readonly fence: FenceClient;
  private readonly fetchImpl: typeof fetch;
  private readonly mock: boolean;
  private readonly now: () => number;
  private readonly storeSubscription: vscode.Disposable;

  private mode: AuthMode;
  private issuer: string | undefined;
  private lastProbeAt: number | undefined;
  private probe: Promise<AuthMode> | undefined;
  private endpoints: Promise<FenceEndpoints> | undefined;

  private session: StoredSession | undefined;
  private refreshing: Promise<AuthHeaders> | undefined;
  private forceRefresh = false;
  private storeReadSeq = 0;

  private authRequired = false;
  private signInPromptShown = false;

  constructor(opts: AuthManagerOptions) {
    this.serverUrl = normalizeServerUrl(opts.serverUrl);
    this.store = opts.store;
    this.fence = opts.fence;
    this.fetchImpl = opts.fetchImpl ?? ((...args) => fetch(...args));
    this.mock = opts.mock ?? false;
    this.now = opts.now ?? (() => Math.floor(Date.now() / 1000));
    this.mode = this.mock ? 'disabled' : 'unknown';
    this.storeSubscription = this.store.onDidChange(this.serverUrl, () => this.onStoreChanged());
  }

  async initialize(): Promise<void> {
    await this.resolveMode(true);
    let stored = await this.store.read(this.serverUrl);
    if (stored && this.mode === 'enabled' && stored.issuer !== this.issuer) {
      logger.info('Stored Orchard session was issued by a different authorization server; removing it');
      await this.store.delete(this.serverUrl);
      stored = undefined;
    }
    if (!this.applySession(stored)) {
      this.setContext('orchard.signedIn', stored !== undefined);
    }
  }

  getSession(): StoredSession | undefined {
    return this.session;
  }

  getMode(): AuthMode {
    return this.mode;
  }

  async getHeaders(): Promise<AuthHeaders> {
    if ((await this.resolveMode()) !== 'enabled') return {};
    if (!this.session) {
      this.applySession(await this.store.read(this.serverUrl));
    }
    await this.enforceIssuer();
    const session = this.session;
    if (!session) return {};
    if (!this.forceRefresh && session.expiresAt - REFRESH_SKEW_SECONDS > this.now()) {
      return bearer(session);
    }
    return this.refresh(session.refreshToken);
  }

  async isAuthenticated(): Promise<boolean> {
    return (await this.resolveMode()) === 'enabled' && this.session !== undefined;
  }

  invalidate(): void {
    this.forceRefresh = true;
  }

  async reportUnauthorized(report: UnauthorizedReport): Promise<void> {
    if (this.mode !== 'enabled') return;
    this.setAuthRequired(true);
    const rejected = this.session;
    if (report.tokenRejected && rejected) {
      await this.deleteIfCurrent(rejected.refreshToken, 'the server rejected its access token');
    }
    if (!this.signInPromptShown) {
      this.signInPromptShown = true;
      this._onDidRequireSignIn.fire();
    }
  }

  reportAuthorized(): void {
    if (this.authRequired) this.setAuthRequired(false);
  }

  async signIn(): Promise<StoredSession> {
    throw new Error('not implemented');
  }

  async signOut(): Promise<void> {
    this.signInPromptShown = true;
    await this.store.delete(this.serverUrl);
    logger.info('Signed out of Orchard');
    if (!this.applySession(undefined)) this.setContext('orchard.signedIn', false);
  }

  dispose(): void {
    this.storeSubscription.dispose();
    this._onDidChangeSession.dispose();
    this._onDidChangeAuthentication.dispose();
    this._onDidRequireSignIn.dispose();
  }

  private resolveMode(force = false): Promise<AuthMode> {
    if (this.mode !== 'unknown') return Promise.resolve(this.mode);
    if (
      !force &&
      this.lastProbeAt !== undefined &&
      this.now() - this.lastProbeAt < MODE_RETRY_SECONDS
    ) {
      return Promise.resolve(this.mode);
    }
    if (!this.probe) {
      this.probe = this.probeMode().finally(() => {
        this.probe = undefined;
      });
    }
    return this.probe;
  }

  private async probeMode(): Promise<AuthMode> {
    this.lastProbeAt = this.now();
    const url = `${this.serverUrl}/api/auth/config`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) {
        logger.warn(`Auth discovery at ${url} returned HTTP ${response.status}`);
        return this.mode;
      }
      const body: unknown = await response.json();
      if (typeof body !== 'object' || body === null || !('issuer' in body)) {
        logger.warn(`Auth discovery at ${url} returned no issuer field`);
        return this.mode;
      }
      const { issuer } = body as { issuer: unknown };
      if (issuer === null) {
        this.mode = 'disabled';
      } else if (typeof issuer === 'string' && issuer !== '') {
        this.issuer = issuer;
        this.mode = 'enabled';
      } else {
        logger.warn(`Auth discovery at ${url} returned an invalid issuer`);
      }
    } catch (err) {
      logger.warn(`Auth discovery at ${url} failed: ${describeError(err)}`);
    } finally {
      clearTimeout(timer);
    }
    return this.mode;
  }

  private getEndpoints(): Promise<FenceEndpoints> {
    if (!this.endpoints) {
      this.endpoints = this.fence.discover(this.issuer as string).catch((err: unknown) => {
        this.endpoints = undefined;
        throw err;
      });
    }
    return this.endpoints;
  }

  private refresh(refreshToken: string): Promise<AuthHeaders> {
    if (!this.refreshing) {
      this.forceRefresh = false;
      this.refreshing = this.refreshOnce(refreshToken, 1).finally(() => {
        this.refreshing = undefined;
      });
    }
    return this.refreshing;
  }

  // Fence rotates refresh tokens, and other windows share the keychain entry: an invalid_grant
  // usually means someone else already rotated, so adopt their result before giving up.
  private async refreshOnce(refreshToken: string, attempt: number): Promise<AuthHeaders> {
    try {
      const endpoints = await this.getEndpoints();
      const response = await this.fence.refresh(endpoints, refreshToken);
      const base = this.session;
      if (!base) return {};
      const next: StoredSession = {
        ...base,
        accessToken: response.accessToken,
        refreshToken: response.refreshToken ?? refreshToken,
        expiresAt: this.now() + response.expiresIn,
      };
      await this.store.write(this.serverUrl, next);
      this.applySession(next);
      return bearer(next);
    } catch (err) {
      if (err instanceof FenceError && err.code === 'invalid_grant') {
        const stored = await this.deleteIfCurrent(refreshToken, 'its refresh token was rejected');
        if (!stored) return {};
        if (stored.expiresAt - REFRESH_SKEW_SECONDS > this.now()) return bearer(stored);
        if (attempt < 2) return this.refreshOnce(stored.refreshToken, attempt + 1);
        return {};
      }
      logger.warn(`Token refresh failed: ${describeError(err)}`);
      const session = this.session;
      return session && session.expiresAt > this.now() ? bearer(session) : {};
    }
  }

  /**
   * Compare-before-delete: deletes the stored session only if it still holds `refreshToken`;
   * otherwise adopts the stored session (written by another window) and returns it.
   */
  private async deleteIfCurrent(
    refreshToken: string,
    reason: string,
  ): Promise<StoredSession | undefined> {
    const stored = await this.store.read(this.serverUrl);
    if (stored && stored.refreshToken !== refreshToken) {
      this.applySession(stored);
      return stored;
    }
    if (stored) await this.store.delete(this.serverUrl);
    logger.info(`Orchard session removed because ${reason}`);
    this.applySession(undefined);
    return undefined;
  }

  private async enforceIssuer(): Promise<void> {
    if (!this.session || this.session.issuer === this.issuer) return;
    const stored = await this.store.read(this.serverUrl);
    if (stored && stored.issuer === this.issuer) {
      this.applySession(stored);
      return;
    }
    if (stored) await this.store.delete(this.serverUrl);
    logger.info('Orchard session removed because the authorization server changed');
    this.applySession(undefined);
  }

  private onStoreChanged(): void {
    const seq = ++this.storeReadSeq;
    this.store.read(this.serverUrl).then(
      (stored) => {
        if (seq === this.storeReadSeq) this.applySession(stored);
      },
      (err: unknown) => logger.warn(`Failed to read Orchard session: ${describeError(err)}`),
    );
  }

  /** Replaces the in-memory session; returns true when presence changed and events fired. */
  private applySession(next: StoredSession | undefined): boolean {
    const previous = this.session;
    this.session = next;
    if ((previous === undefined) === (next === undefined)) return false;
    this.setContext('orchard.signedIn', next !== undefined);
    this._onDidChangeSession.fire(next ? { added: next } : { removed: previous });
    this._onDidChangeAuthentication.fire();
    return true;
  }

  private setAuthRequired(value: boolean): void {
    this.authRequired = value;
    this.setContext('orchard.authRequired', value);
  }

  private setContext(key: string, value: boolean): void {
    try {
      Promise.resolve(vscode.commands.executeCommand('setContext', key, value)).catch(
        (err: unknown) => logger.warn(`Failed to set context ${key}: ${describeError(err)}`),
      );
    } catch (err) {
      logger.warn(`Failed to set context ${key}: ${describeError(err)}`);
    }
  }
}
