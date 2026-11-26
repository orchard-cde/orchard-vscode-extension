import * as vscode from 'vscode';
import type { AuthManager } from './authManager';
import { normalizeServerUrl, type StoredSession } from './sessionStore';

export const AUTH_PROVIDER_ID = 'orchard';
export const AUTH_PROVIDER_LABEL = 'Orchard';

export function toSession(serverUrl: string, s: StoredSession): vscode.AuthenticationSession {
  return {
    id: `${s.account.id}@${normalizeServerUrl(serverUrl)}`,
    accessToken: s.accessToken,
    account: { id: s.account.id, label: s.account.label },
    scopes: ['openid'],
  };
}

export class OrchardAuthenticationProvider implements vscode.AuthenticationProvider, vscode.Disposable {
  private readonly emitter =
    new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
  readonly onDidChangeSessions = this.emitter.event;

  private manager: AuthManager | undefined;
  private subscription: vscode.Disposable | undefined;

  setManager(manager: AuthManager | undefined): void {
    this.subscription?.dispose();
    this.subscription = undefined;

    const previous = this.manager;
    const previousSession = previous?.getSession();
    this.manager = manager;
    if (previous && previousSession) {
      this.fire(previous, { removed: previousSession });
    }

    if (!manager) return;
    this.subscription = manager.onDidChangeSession((change) => {
      if (change.added) this.fire(manager, { added: change.added });
      if (change.removed) this.fire(manager, { removed: change.removed });
    });
    const session = manager.getSession();
    if (session) this.fire(manager, { added: session });
  }

  async getSessions(_scopes?: readonly string[]): Promise<vscode.AuthenticationSession[]> {
    const current = this.currentSession();
    return current ? [current] : [];
  }

  async createSession(_scopes: readonly string[]): Promise<vscode.AuthenticationSession> {
    if (!this.manager) throw new Error('Orchard is not configured');
    return toSession(this.manager.serverUrl, await this.manager.signIn());
  }

  async removeSession(sessionId: string): Promise<void> {
    const current = this.currentSession();
    if (this.manager && current?.id === sessionId) {
      await this.manager.signOut();
    }
  }

  dispose(): void {
    this.subscription?.dispose();
    this.subscription = undefined;
    this.emitter.dispose();
  }

  private currentSession(): vscode.AuthenticationSession | undefined {
    const session = this.manager?.getSession();
    return this.manager && session ? toSession(this.manager.serverUrl, session) : undefined;
  }

  private fire(manager: AuthManager, change: { added?: StoredSession; removed?: StoredSession }): void {
    this.emitter.fire({
      added: change.added ? [toSession(manager.serverUrl, change.added)] : undefined,
      removed: change.removed ? [toSession(manager.serverUrl, change.removed)] : undefined,
      changed: undefined,
    });
  }
}
