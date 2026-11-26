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
  CMD_SIGN_IN,
  CMD_SIGN_OUT,
  CONFIG_SERVER_URL,
} from './constants';
import {
  AuthManager,
  SessionStore,
  FenceClient,
  OrchardAuthenticationProvider,
  AUTH_PROVIDER_ID,
  AUTH_PROVIDER_LABEL,
} from './api/auth';
import { TrellisApiError } from './api/types';
import { TrellisClient, ITrellisClient } from './api/trellisClient';
import { MockTrellisClient } from './mock/mockTrellisClient';
import { GroveManager } from './services/groveManager';
import { GroveTreeDataProvider } from './views/groveTreeDataProvider';
import { OrchardWebviewProvider } from './views/orchardWebviewProvider';
import { GroveTreeItem } from './views/groveTreeItem';
import { getServerUrl, getSseEnabled, getLogLevel } from './util/configuration';
import { SseManager } from './services/sseManager';
import { createStatusBarItem, updateStatusBar } from './views/statusBar';
import * as logger from './util/logger';
import { LogLevel } from './util/logger';
import { createGrove } from './commands/createGrove';
import { connectGrove } from './commands/connectGrove';
import { deleteGrove } from './commands/deleteGrove';
import { stopGrove } from './commands/stopGrove';
import { startGrove } from './commands/startGrove';
import { refreshGroves } from './commands/refreshGroves';
import { TrowelService } from './services/trowelService';
import { TrowelUpdater } from './services/trowelUpdater';

let sessionStore: SessionStore;
let fenceClient: FenceClient;
let authenticationProvider: OrchardAuthenticationProvider;
let authManager: AuthManager | undefined;
let trellisClient: ITrellisClient | undefined;
let sseManager: SseManager | undefined;
let groveManager: GroveManager | undefined;
let treeDataProvider: GroveTreeDataProvider | undefined;
let webviewProvider: OrchardWebviewProvider | undefined;
let groveTreeView: vscode.TreeView<unknown> | undefined;

function initializeServices(context: vscode.ExtensionContext, serverUrl: string, mockMode: boolean): void {
  // Dispose previous instances
  authManager?.dispose();
  sseManager?.dispose();
  groveManager?.dispose();
  treeDataProvider?.dispose();

  const manager = new AuthManager({ serverUrl, store: sessionStore, fence: fenceClient, mock: mockMode });
  authManager = manager;
  authenticationProvider.setManager(manager);
  void manager.initialize().catch((err) => {
    logger.warn(`Failed to initialize Orchard authentication: ${err}`);
  });

  trellisClient = mockMode ? new MockTrellisClient() : new TrellisClient(serverUrl, manager);

  if (!mockMode && getSseEnabled()) {
    sseManager = new SseManager(serverUrl, manager);
  } else {
    sseManager = undefined;
  }

  const groves = new GroveManager(trellisClient, sseManager);
  groveManager = groves;
  treeDataProvider = new GroveTreeDataProvider(groves);
  webviewProvider = new OrchardWebviewProvider(context, trellisClient, groves, sseManager);

  manager.onDidRequireSignIn(async () => {
    const action = await vscode.window.showInformationMessage('Orchard needs you to sign in.', 'Sign In');
    if (action === 'Sign In') {
      vscode.commands.executeCommand(CMD_SIGN_IN);
    }
  });
  manager.onDidChangeAuthentication(() => {
    if (!manager.getSession()) groves.clearCache();
    groves.refresh().catch((err) => {
      logger.warn(`Failed to refresh groves after authentication change: ${err}`);
    });
  });
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
  const mockMode = process.env.ORCHARD_MOCK === '1';
  const serverUrl = getServerUrl();

  // Initialize log level from configuration (env var overrides for launch configs)
  const envLogLevel = process.env.ORCHARD_LOG_LEVEL as LogLevel | undefined;
  logger.setLogLevel(envLogLevel || (getLogLevel() as LogLevel));

  sessionStore = new SessionStore(context.secrets);
  fenceClient = new FenceClient();
  authenticationProvider = new OrchardAuthenticationProvider();
  context.subscriptions.push(
    authenticationProvider,
    vscode.authentication.registerAuthenticationProvider(
      AUTH_PROVIDER_ID,
      AUTH_PROVIDER_LABEL,
      authenticationProvider,
      { supportsMultipleAccounts: false },
    ),
  );

  // Set configured context for when-clauses in package.json
  vscode.commands.executeCommand('setContext', 'orchard.configured', !!serverUrl || mockMode);

  // Initialize services if configured (or in mock mode)
  if (serverUrl || mockMode) {
    initializeServices(context, serverUrl, mockMode);
    logger.info(
      mockMode
        ? 'Orchard initialized in MOCK mode (no server)'
        : `Orchard initialized with server: ${serverUrl}`,
    );
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

  registerCommand(context, CMD_SIGN_IN, () => {
    if (!authManager) {
      vscode.window.showInformationMessage('Configure your Orchard server URL first.');
      return;
    }
    authManager.signIn().catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      if (message !== 'Sign-in cancelled') {
        vscode.window.showErrorMessage(message);
      }
    });
  });

  registerCommand(context, CMD_SIGN_OUT, () => {
    authManager?.signOut().catch((err) => {
      logger.error(`Failed to sign out: ${err}`);
    });
  });

  // Listen for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(CONFIG_SERVER_URL)) {
        const newServerUrl = getServerUrl();
        vscode.commands.executeCommand('setContext', 'orchard.configured', !!newServerUrl || mockMode);

        if (newServerUrl) {
          initializeServices(context, newServerUrl, mockMode);
          createTreeView(context, treeDataProvider!);

          groveManager!.startPolling();
          groveManager!.refresh().catch((err) => {
            logger.error(`Failed to refresh groves after config change: ${err}`);
          });
          logger.info(`Orchard reconfigured with server: ${newServerUrl}`);
        } else {
          groveManager?.stopPolling();
          sseManager?.unsubscribeAll();
          groveManager?.clearCache();
          authManager?.dispose();
          authManager = undefined;
          authenticationProvider.setManager(undefined);
          vscode.commands.executeCommand('setContext', 'orchard.signedIn', false);
          vscode.commands.executeCommand('setContext', 'orchard.authRequired', false);
          logger.info('Orchard server URL cleared; polling stopped.');
        }
      }
    }),
  );

  // Start polling and initial refresh if configured
  if (groveManager) {
    groveManager.startPolling();
    groveManager.refresh().catch(async (err) => {
      if (err instanceof TrellisApiError && err.statusCode === 401) {
        logger.info('Initial grove refresh needs sign-in');
        return;
      }
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

  // Auto-update Trowel CLI, then fall back to user-facing message if still missing
  const trowelService = new TrowelService(context.globalStoragePath);
  const trowelUpdater = new TrowelUpdater(context, trowelService);
  trowelUpdater.ensureLatestTrowel().catch((err) => {
    logger.warn(`Trowel auto-update failed: ${err}`);
  }).finally(() => {
    // If no binary exists after auto-update attempt, show the fallback notification
    trowelService.promptInstallIfMissing().catch((err) => {
      logger.warn(`Trowel fallback prompt failed: ${err}`);
    });
  });

  // Push service disposables
  context.subscriptions.push({ dispose: () => authManager?.dispose() });
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
