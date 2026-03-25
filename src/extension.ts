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
  CONFIG_SERVER_URL,
  CONFIG_CULTIVATOR_ID,
} from './constants';
import { HeaderAuthProvider } from './api/auth/headerAuthProvider';
import { TrellisClient } from './api/trellisClient';
import { GroveManager } from './services/groveManager';
import { GroveTreeDataProvider } from './views/groveTreeDataProvider';
import { getServerUrl } from './util/configuration';
import * as logger from './util/logger';

let authProvider: HeaderAuthProvider | undefined;
let trellisClient: TrellisClient | undefined;
let groveManager: GroveManager | undefined;
let treeDataProvider: GroveTreeDataProvider | undefined;
let groveTreeView: vscode.TreeView<unknown> | undefined;

function initializeServices(serverUrl: string): void {
  // Dispose previous instances
  authProvider?.dispose();
  groveManager?.dispose();
  treeDataProvider?.dispose();

  authProvider = new HeaderAuthProvider();
  trellisClient = new TrellisClient(serverUrl, authProvider);
  groveManager = new GroveManager(trellisClient);
  treeDataProvider = new GroveTreeDataProvider(groveManager);
}

function createTreeView(
  context: vscode.ExtensionContext,
  provider: vscode.TreeDataProvider<unknown>,
): void {
  groveTreeView?.dispose();
  groveTreeView = vscode.window.createTreeView(VIEW_GROVE_EXPLORER, {
    treeDataProvider: provider,
    showCollapseAll: false,
  });
  context.subscriptions.push(groveTreeView);
}

function registerCommand(
  context: vscode.ExtensionContext,
  id: string,
  handler: (...args: unknown[]) => void,
): void {
  context.subscriptions.push(vscode.commands.registerCommand(id, handler));
}

export function activate(context: vscode.ExtensionContext): void {
  const serverUrl = getServerUrl();

  // Set configured context for when-clauses in package.json
  vscode.commands.executeCommand('setContext', 'orchard.configured', !!serverUrl);

  // Initialize services if configured
  if (serverUrl) {
    initializeServices(serverUrl);
    logger.info(`Orchard initialized with server: ${serverUrl}`);
  }

  // Register the tree view
  createTreeView(context, treeDataProvider ?? new EmptyTreeDataProvider());

  // Register command stubs
  registerCommand(context, CMD_GROVE_CREATE, () => {
    vscode.window.showInformationMessage('Orchard: Create Grove (not yet implemented)');
  });

  registerCommand(context, CMD_GROVE_CONNECT, () => {
    vscode.window.showInformationMessage('Orchard: Connect to Grove (not yet implemented)');
  });

  registerCommand(context, CMD_GROVE_STOP, () => {
    vscode.window.showInformationMessage('Orchard: Stop Grove (not yet implemented)');
  });

  registerCommand(context, CMD_GROVE_START, () => {
    vscode.window.showInformationMessage('Orchard: Start Grove (not yet implemented)');
  });

  registerCommand(context, CMD_GROVE_DELETE, () => {
    vscode.window.showInformationMessage('Orchard: Delete Grove (not yet implemented)');
  });

  registerCommand(context, CMD_GROVE_REFRESH, () => {
    if (groveManager) {
      groveManager.refresh().catch((err) => {
        logger.error(`Failed to refresh groves: ${err}`);
      });
    }
  });

  registerCommand(context, CMD_GROVE_COPY_ID, () => {
    vscode.window.showInformationMessage('Orchard: Copy Grove ID (not yet implemented)');
  });

  registerCommand(context, CMD_GROVE_SHOW_DETAILS, () => {
    vscode.window.showInformationMessage('Orchard: Show Grove Details (not yet implemented)');
  });

  // Listen for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(CONFIG_SERVER_URL) || e.affectsConfiguration(CONFIG_CULTIVATOR_ID)) {
        const newServerUrl = getServerUrl();
        vscode.commands.executeCommand('setContext', 'orchard.configured', !!newServerUrl);

        if (newServerUrl) {
          initializeServices(newServerUrl);
          createTreeView(context, treeDataProvider!);

          groveManager!.startPolling();
          groveManager!.refresh().catch((err) => {
            logger.error(`Failed to refresh groves after config change: ${err}`);
          });
          logger.info(`Orchard reconfigured with server: ${newServerUrl}`);
        } else {
          groveManager?.stopPolling();
          logger.info('Orchard server URL cleared; polling stopped.');
        }
      }
    }),
  );

  // Start polling and initial refresh if configured
  if (groveManager) {
    groveManager.startPolling();
    groveManager.refresh().catch((err) => {
      logger.error(`Failed initial grove refresh: ${err}`);
    });
  }

  // Push service disposables
  if (authProvider) {
    context.subscriptions.push(authProvider);
  }
  if (groveManager) {
    context.subscriptions.push(groveManager);
  }
  if (treeDataProvider) {
    context.subscriptions.push(treeDataProvider);
  }
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
