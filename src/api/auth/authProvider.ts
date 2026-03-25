import * as vscode from 'vscode';

export interface AuthProvider {
  getHeaders(): Promise<Record<string, string>>;
  isAuthenticated(): Promise<boolean>;
  onDidChangeAuthentication: vscode.Event<void>;
}
