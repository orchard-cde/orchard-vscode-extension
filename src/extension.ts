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
  CMD_SHOW_DASHBOARD,
  CONFIG_SERVER_URL,
  CONFIG_CULTIVATOR_ID,
} from './constants';
import { HeaderAuthProvider } from './api/auth/headerAuthProvider';
import { TrellisClient } from './api/trellisClient';
import { GroveManager } from './services/groveManager';
import { GroveTreeDataProvider } from './views/groveTreeDataProvider';
import { OrchardWebviewProvider } from './views/orchardWebviewProvider';
import { GroveTreeItem } from './views/groveTreeItem';
import { getServerUrl, getSseEnabled } from './util/configuration';
import { SseManager } from './services/sseManager';
import { createStatusBarItem, updateStatusBar } from './views/statusBar';
import * as logger from './util/logger';
import { createGrove } from './commands/createGrove';
import { connectGrove } from './commands/connectGrove';
import { deleteGrove } from './commands/deleteGrove';
import { stopGrove } from './commands/stopGrove';
import { startGrove } from './commands/startGrove';
import { refreshGroves } from './commands/refreshGroves';
import { TrowelService } from './services/trowelService';

let authProvider: HeaderAuthProvider | undefined;
let trellisClient: TrellisClient | undefined;
let sseManager: SseManager | undefined;
let groveManager: GroveManager | undefined;
let treeDataProvider: GroveTreeDataProvider | undefined;
let webviewProvider: OrchardWebviewProvider | undefined;
let groveTreeView: vscode.TreeView<unknown> | undefined;

function initializeServices(context: vscode.ExtensionContext, serverUrl: string): void {
  // Dispose previous instances
  authProvider?.dispose();
  sseManager?.dispose();
  groveManager?.dispose();
  treeDataProvider?.dispose();

  authProvider = new HeaderAuthProvider();
  trellisClient = new TrellisClient(serverUrl, authProvider);

  if (getSseEnabled()) {
    sseManager = new SseManager(serverUrl, authProvider);
  } else {
    sseManager = undefined;
  }

  groveManager = new GroveManager(trellisClient, sseManager);
  treeDataProvider = new GroveTreeDataProvider(groveManager);
  webviewProvider = new OrchardWebviewProvider(context, trellisClient, groveManager, sseManager);
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
    initializeServices(context, serverUrl);
    logger.info(`Orchard initialized with server: ${serverUrl}`);
  }

  // Create and register status bar item
  const statusBarItem = createStatusBarItem();
  context.subscriptions.push(statusBarItem);
  updateStatusBar(statusBarItem);

  // Register the tree view
  createTreeView(context, treeDataProvider ?? new EmptyTreeDataProvider());

  // Register commands
  registerCommand(context, CMD_GROVE_CREATE, () => {
    if (groveManager) {
      createGrove(groveManager).catch((err) => {
        logger.error(`Failed to create grove: ${err}`);
        vscode.window.showErrorMessage(`Failed to create grove: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  });

  registerCommand(context, CMD_GROVE_CONNECT, (item: unknown) => {
    if (item instanceof GroveTreeItem && trellisClient) {
      connectGrove(item.grove, trellisClient).catch((err) => {
        logger.error(`Failed to connect to grove: ${err}`);
        vscode.window.showErrorMessage(`Failed to connect to grove: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  });

  registerCommand(context, CMD_GROVE_STOP, (item: unknown) => {
    if (item instanceof GroveTreeItem && groveManager) {
      stopGrove(item.grove, groveManager).catch((err) => {
        logger.error(`Failed to stop grove: ${err}`);
        vscode.window.showErrorMessage(`Failed to stop grove: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  });

  registerCommand(context, CMD_GROVE_START, (item: unknown) => {
    if (item instanceof GroveTreeItem && groveManager) {
      startGrove(item.grove, groveManager).catch((err) => {
        logger.error(`Failed to start grove: ${err}`);
        vscode.window.showErrorMessage(`Failed to start grove: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  });

  registerCommand(context, CMD_GROVE_DELETE, (item: unknown) => {
    if (item instanceof GroveTreeItem && groveManager) {
      deleteGrove(item.grove, groveManager).catch((err) => {
        logger.error(`Failed to delete grove: ${err}`);
        vscode.window.showErrorMessage(`Failed to delete grove: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  });

  registerCommand(context, CMD_GROVE_REFRESH, () => {
    if (groveManager) {
      refreshGroves(groveManager).catch((err) => {
        logger.error(`Failed to refresh groves: ${err}`);
        vscode.window.showErrorMessage(`Failed to refresh groves: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  });

  registerCommand(context, CMD_GROVE_COPY_ID, (item: unknown) => {
    if (item instanceof GroveTreeItem) {
      vscode.env.clipboard.writeText(item.grove.id);
      vscode.window.showInformationMessage(`Copied grove ID: ${item.grove.id}`);
    }
  });

  registerCommand(context, CMD_GROVE_SHOW_DETAILS, (item: unknown) => {
    if (item instanceof GroveTreeItem) {
      webviewProvider?.navigateToGrove(item.grove.id);
    }
  });

  registerCommand(context, CMD_SHOW_DASHBOARD, () => {
    webviewProvider?.show();
  });

  // Listen for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(CONFIG_SERVER_URL) || e.affectsConfiguration(CONFIG_CULTIVATOR_ID)) {
        const newServerUrl = getServerUrl();
        vscode.commands.executeCommand('setContext', 'orchard.configured', !!newServerUrl);

        if (newServerUrl) {
          initializeServices(context, newServerUrl);
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
    groveManager.refresh().catch(async (err) => {
      logger.error(`Failed initial grove refresh: ${err}`);
      const action = await vscode.window.showErrorMessage(
        'Could not connect to Orchard server. Check your server URL.',
        'Open Settings',
      );
      if (action === 'Open Settings') {
        vscode.commands.executeCommand('workbench.action.openSettings', 'orchard.serverUrl');
      }
    });
  }

  const wp = webviewProvider;
  if (wp && groveManager) {
    groveManager.onDidChangeGroves(() => {
      wp.notifyGroveListChanged();
    });
  }

  // Check for Trowel CLI (non-blocking)
  const trowelService = new TrowelService();
  trowelService.promptInstallIfMissing().catch((err) => {
    logger.warn(`Trowel detection failed: ${err}`);
  });

  // Push service disposables
  if (authProvider) {
    context.subscriptions.push(authProvider);
  }
  if (sseManager) {
    context.subscriptions.push(sseManager);
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
