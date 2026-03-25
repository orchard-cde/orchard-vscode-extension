import * as vscode from 'vscode';
import {
  VIEW_GROVE_EXPLORER,
  CMD_GROVE_CREATE,
  CMD_GROVE_CONNECT,
  CMD_GROVE_STOP,
  CMD_GROVE_START,
  CMD_GROVE_DELETE,
  CMD_GROVE_REFRESH,
  CMD_GROVE_COPY_ID,
  CMD_GROVE_SHOW_DETAILS,
} from './constants';

const disposables: vscode.Disposable[] = [];

function registerCommand(id: string, handler: (...args: unknown[]) => void): void {
  disposables.push(vscode.commands.registerCommand(id, handler));
}

export function activate(context: vscode.ExtensionContext): void {
  // Register command stubs
  registerCommand(CMD_GROVE_CREATE, () => {
    vscode.window.showInformationMessage('Orchard: Create Grove (not yet implemented)');
  });

  registerCommand(CMD_GROVE_CONNECT, () => {
    vscode.window.showInformationMessage('Orchard: Connect to Grove (not yet implemented)');
  });

  registerCommand(CMD_GROVE_STOP, () => {
    vscode.window.showInformationMessage('Orchard: Stop Grove (not yet implemented)');
  });

  registerCommand(CMD_GROVE_START, () => {
    vscode.window.showInformationMessage('Orchard: Start Grove (not yet implemented)');
  });

  registerCommand(CMD_GROVE_DELETE, () => {
    vscode.window.showInformationMessage('Orchard: Delete Grove (not yet implemented)');
  });

  registerCommand(CMD_GROVE_REFRESH, () => {
    vscode.window.showInformationMessage('Orchard: Refresh Groves (not yet implemented)');
  });

  registerCommand(CMD_GROVE_COPY_ID, () => {
    vscode.window.showInformationMessage('Orchard: Copy Grove ID (not yet implemented)');
  });

  registerCommand(CMD_GROVE_SHOW_DETAILS, () => {
    vscode.window.showInformationMessage('Orchard: Show Grove Details (not yet implemented)');
  });

  // Register empty tree view
  const treeDataProvider = new EmptyTreeDataProvider();
  const treeView = vscode.window.createTreeView(VIEW_GROVE_EXPLORER, {
    treeDataProvider,
    showCollapseAll: false,
  });
  disposables.push(treeView);

  // Add all disposables to the extension context
  context.subscriptions.push(...disposables);
}

export function deactivate(): void {
  // Disposables are cleaned up via context.subscriptions
}

class EmptyTreeDataProvider implements vscode.TreeDataProvider<never> {
  getTreeItem(_element: never): vscode.TreeItem {
    return new vscode.TreeItem('');
  }

  getChildren(_element?: never): never[] {
    return [];
  }
}
