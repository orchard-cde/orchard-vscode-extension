import * as vscode from 'vscode';

export type AuthMode = 'disabled' | 'unknown' | 'enabled';

export interface UnauthorizedReport {
  tokenRejected: boolean;
  /** The access token the rejected request carried; a stale token is ignored. */
  rejectedAccessToken?: string;
}

export interface AuthProvider {
  getHeaders(): Promise<Record<string, string>>;
  isAuthenticated(): Promise<boolean>;
  getMode(): AuthMode;
  invalidate(): void;
  reportUnauthorized(report: UnauthorizedReport): Promise<void>;
  reportAuthorized(): void;
  onDidChangeAuthentication: vscode.Event<void>;
}
