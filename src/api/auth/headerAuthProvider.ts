import * as vscode from 'vscode';
import { AuthProvider } from './authProvider';
import { CONFIG_CULTIVATOR_ID } from '../../constants';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class HeaderAuthProvider implements AuthProvider, vscode.Disposable {
  private readonly _onDidChangeAuthentication = new vscode.EventEmitter<void>();
  public readonly onDidChangeAuthentication = this._onDidChangeAuthentication.event;

  private readonly _disposable: vscode.Disposable;

  constructor() {
    this._disposable = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(CONFIG_CULTIVATOR_ID)) {
        this._onDidChangeAuthentication.fire();
      }
    });
  }

  async getHeaders(): Promise<Record<string, string>> {
    const cultivatorId = this.getCultivatorId();
    if (cultivatorId && UUID_REGEX.test(cultivatorId)) {
      return { 'X-Cultivator-Id': cultivatorId };
    }
    return {};
  }

  async isAuthenticated(): Promise<boolean> {
    const cultivatorId = this.getCultivatorId();
    return !!cultivatorId && UUID_REGEX.test(cultivatorId);
  }

  private getCultivatorId(): string {
    return vscode.workspace
      .getConfiguration('orchard')
      .get<string>('cultivatorId', '');
  }

  dispose(): void {
    this._onDidChangeAuthentication.dispose();
    this._disposable.dispose();
  }
}
