import * as vscode from 'vscode';
import { AuthMode, AuthProvider, UnauthorizedReport } from './authProvider';
import { pollForToken } from './deviceFlow';
import { DeviceAuthorization, FenceClient, FenceEndpoints, FenceError } from './fenceClient';
import {
  SessionStore,
  StoredSession,
  accountFromAccessToken,
  normalizeServerUrl,
} from './sessionStore';
import * as logger from '../../util/logger';

const REFRESH_SKEW_SECONDS = 30;
const MODE_RETRY_SECONDS = 60;
const CONFIG_TIMEOUT_MS = 10_000;
const ROTATION_GRACE_MS = 2_000;

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  private endpoints: { issuer: string; promise: Promise<FenceEndpoints> } | undefined;

  private session: StoredSession | undefined;
  private refreshing: Promise<AuthHeaders> | undefined;
  private forceRefresh = false;
  private signOutGeneration = 0;
  private storeReadSeq = 0;

  private authRequired = false;
  private signInPromptShown = false;
  private signingIn: Promise<StoredSession> | undefined;
  private disposed = false;

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
    return this.refresh(session);
  }

  async isAuthenticated(): Promise<boolean> {
    return (await this.resolveMode()) === 'enabled' && this.session !== undefined;
  }

  invalidate(): void {
    this.forceRefresh = true;
  }

  async reportUnauthorized(report: UnauthorizedReport): Promise<void> {
    if (this.mode !== 'enabled') return;
    const rejected = this.session;
    if (
      report.tokenRejected &&
      rejected &&
      report.rejectedAccessToken !== undefined &&
      report.rejectedAccessToken !== rejected.accessToken
    ) {
      return;
    }
    if (report.tokenRejected && rejected) {
      const adopted = await this.deleteIfCurrent(
        rejected.refreshToken,
        'the server rejected its access token',
      );
      if (adopted) return;
    }
    this.setAuthRequired(true);
    if (!this.signInPromptShown) {
      this.signInPromptShown = true;
      this._onDidRequireSignIn.fire();
    }
  }

  reportAuthorized(): void {
    if (this.authRequired) this.setAuthRequired(false);
  }

  signIn(): Promise<StoredSession> {
    if (this.signingIn) {
      void vscode.window.showInformationMessage('Sign-in is already in progress.');
      return this.signingIn;
    }
    this.signingIn = this.runSignIn().finally(() => {
      this.signingIn = undefined;
    });
    return this.signingIn;
  }

  async signOut(): Promise<void> {
    this.signOutGeneration++;
    this.signInPromptShown = true;
    await this.store.delete(this.serverUrl);
    logger.info('Signed out of Orchard');
    if (!this.applySession(undefined)) this.setContext('orchard.signedIn', false);
  }

  dispose(): void {
    this.disposed = true;
    this.storeSubscription.dispose();
    this._onDidChangeSession.dispose();
    this._onDidChangeAuthentication.dispose();
    this._onDidRequireSignIn.dispose();
  }

  private async runSignIn(): Promise<StoredSession> {
    if (this.mock) throw new Error('Sign-in is not available in mock mode');
    const mode = await this.discoverMode();
    if (mode === 'disabled') throw new Error('This Orchard server has authentication disabled');
    if (mode === 'unknown') throw new Error('Could not reach the Orchard server to start sign-in');
    const issuer = this.issuer as string;

    let endpoints: FenceEndpoints;
    let auth: DeviceAuthorization;
    try {
      endpoints = await this.getEndpoints();
      auth = await this.fence.requestDeviceAuthorization(endpoints);
    } catch (err) {
      throw new Error(`Sign-in failed: ${describeError(err)}`);
    }

    try {
      await vscode.env.clipboard.writeText(auth.userCode);
    } catch (err) {
      logger.warn(`Could not copy the sign-in code to the clipboard: ${describeError(err)}`);
    }
    const verificationUri = auth.verificationUriComplete ?? auth.verificationUri;
    try {
      await vscode.env.openExternal(vscode.Uri.parse(verificationUri));
    } catch (err) {
      logger.warn(`Could not open the sign-in page: ${describeError(err)}`);
    }

    const response = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Signing in to Orchard. Confirm code ${auth.userCode} in your browser.`,
        cancellable: true,
      },
      (_progress, token) =>
        pollForToken(this.fence, endpoints, auth, token, { isCancelled: () => this.disposed }),
    );

    if (!response.refreshToken) {
      throw new Error('Sign-in failed: the authorization server returned no refresh token');
    }
    let account: StoredSession['account'];
    try {
      account = accountFromAccessToken(response.accessToken);
    } catch (err) {
      throw new Error(`Sign-in failed: ${describeError(err)}`);
    }
    const session: StoredSession = {
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      expiresAt: this.now() + response.expiresIn,
      issuer,
      account,
    };
    this.signOutGeneration++;
    await this.store.write(this.serverUrl, session);
    this.applySession(session);
    this.setAuthRequired(false);
    this.signInPromptShown = false;
    logger.info('Signed in to Orchard');
    return session;
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
    return this.discoverMode();
  }

  /** Fetches the auth config regardless of the cached mode; a failed fetch leaves the cache intact. */
  private discoverMode(): Promise<AuthMode> {
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
        return 'unknown';
      }
      const body: unknown = await response.json();
      if (typeof body !== 'object' || body === null || !('issuer' in body)) {
        logger.warn(`Auth discovery at ${url} returned no issuer field`);
        return 'unknown';
      }
      const { issuer } = body as { issuer: unknown };
      if (issuer === null) {
        this.issuer = undefined;
        this.mode = 'disabled';
        return this.mode;
      }
      if (typeof issuer === 'string' && issuer !== '') {
        this.issuer = issuer;
        this.mode = 'enabled';
        return this.mode;
      }
      logger.warn(`Auth discovery at ${url} returned an invalid issuer`);
    } catch (err) {
      logger.warn(`Auth discovery at ${url} failed: ${describeError(err)}`);
    } finally {
      clearTimeout(timer);
    }
    return 'unknown';
  }

  private getEndpoints(): Promise<FenceEndpoints> {
    const issuer = this.issuer as string;
    if (this.endpoints?.issuer !== issuer) {
      const entry = {
        issuer,
        promise: this.fence.discover(issuer).catch((err: unknown) => {
          if (this.endpoints === entry) this.endpoints = undefined;
          throw err;
        }),
      };
      this.endpoints = entry;
    }
    return this.endpoints.promise;
  }

  private refresh(session: StoredSession): Promise<AuthHeaders> {
    if (!this.refreshing) {
      this.forceRefresh = false;
      this.refreshing = this.refreshOnce(session, 1, this.signOutGeneration).finally(() => {
        this.refreshing = undefined;
      });
    }
    return this.refreshing;
  }

  // Fence rotates refresh tokens, and other windows share the keychain entry: an invalid_grant
  // usually means someone else already rotated, so adopt their result before giving up. A
  // successful rotation is always persisted (it is the only valid refresh token) unless this
  // window signed out meanwhile.
  private async refreshOnce(
    base: StoredSession,
    attempt: number,
    generation: number,
  ): Promise<AuthHeaders> {
    const refreshToken = base.refreshToken;
    try {
      const endpoints = await this.getEndpoints();
      const response = await this.fence.refresh(endpoints, refreshToken);
      if (this.disposed || generation !== this.signOutGeneration) return {};
      const next: StoredSession = {
        ...base,
        accessToken: response.accessToken,
        refreshToken: response.refreshToken ?? refreshToken,
        expiresAt: this.now() + response.expiresIn,
      };
      await this.store.write(this.serverUrl, next);
      if (this.disposed || generation !== this.signOutGeneration) return {};
      this.applySession(next);
      return bearer(next);
    } catch (err) {
      if (err instanceof FenceError && err.code === 'invalid_grant') {
        const stored = await this.deleteIfCurrent(
          refreshToken,
          'its refresh token was rejected',
          ROTATION_GRACE_MS,
        );
        if (!stored) return {};
        if (stored.expiresAt - REFRESH_SKEW_SECONDS > this.now()) return bearer(stored);
        if (attempt < 2) return this.refreshOnce(stored, attempt + 1, generation);
        return {};
      }
      logger.warn(`Token refresh failed: ${describeError(err)}`);
      const session = this.session;
      return session && session.expiresAt > this.now() ? bearer(session) : {};
    }
  }

  /**
   * Compare-before-delete: deletes the stored session only if it still holds `refreshToken`;
   * otherwise adopts the stored session (written by another window) and returns it. A non-zero
   * `graceMs` gives a concurrent rotation in another window time to persist before deciding.
   */
  private async deleteIfCurrent(
    refreshToken: string,
    reason: string,
    graceMs = 0,
  ): Promise<StoredSession | undefined> {
    let stored = await this.store.read(this.serverUrl);
    if (stored && stored.refreshToken === refreshToken && graceMs > 0) {
      await delay(graceMs);
      if (this.disposed) return undefined;
      stored = await this.store.read(this.serverUrl);
    }
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
