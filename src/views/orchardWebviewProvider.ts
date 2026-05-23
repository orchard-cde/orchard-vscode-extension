import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { TrellisClient } from '../api/trellisClient';
import { GroveManager } from '../services/groveManager';
import { SseManager } from '../services/sseManager';
import * as logger from '../util/logger';
import { connectGrove } from '../commands/connectGrove';

export class OrchardWebviewProvider implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private sseDisposable: vscode.Disposable | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly trellisClient: TrellisClient,
    private readonly groveManager: GroveManager,
    private readonly sseManager?: SseManager,
  ) {}

  show(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'orchard.dashboard',
      'Orchard Dashboard',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(this.context.extensionPath, 'dist', 'webview')),
        ],
      },
    );

    this.panel.webview.html = this.getHtml();

    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.sseDisposable?.dispose();
      this.sseDisposable = undefined;
    }, null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      (message) => this.handleMessage(message),
      null,
      this.disposables,
    );

    this.startSseForwarding();
  }

  private getHtml(): string {
    const webviewPath = vscode.Uri.file(
      path.join(this.context.extensionPath, 'dist', 'webview', 'index.html'),
    );
    const baseUri = this.panel!.webview.asWebviewUri(
      vscode.Uri.file(path.join(this.context.extensionPath, 'dist', 'webview')),
    );

    const html = fs.readFileSync(webviewPath.fsPath, 'utf-8');
    return html.replace(/<base\s+href=["'].*?["']\s*\/?>/, `<base href="${baseUri}/">`);
  }

  private async handleMessage(message: { type: string; payload?: Record<string, unknown> }): Promise<void> {
    const respond = (data?: unknown, error?: string) => {
      this.postMessage({
        type: message.type,
        success: !error,
        data,
        error,
      });
    };

    try {
      switch (message.type) {
        case 'listGroves': {
          const groves = this.groveManager.getGroves();
          respond(groves);
          break;
        }
        case 'getGrove': {
          const id = message.payload?.id as string;
          if (!id) { respond(undefined, 'Missing grove id'); return; }
          const grove = await this.trellisClient.getGrove(id);
          respond(grove);
          break;
        }
        case 'createGrove': {
          const p = message.payload as Record<string, unknown>;
          const grove = await this.groveManager.createGrove({
            repositoryUrl: p.repositoryUrl as string,
            branch: (p.branch as string) || 'main',
            name: p.name as string | undefined,
            machineSize: p.machineSize as 'small' | 'medium' | 'large' | undefined,
          });
          respond(grove);
          break;
        }
        case 'connectGrove': {
          const connId = message.payload?.id as string;
          if (!connId) { respond(undefined, 'Missing grove id'); return; }
          const grove = this.groveManager.getGrove(connId);
          if (!grove) { respond(undefined, 'Grove not found'); return; }
          await connectGrove(grove, this.trellisClient);
          respond(null);
          break;
        }
        case 'deleteGrove': {
          const id = message.payload?.id as string;
          if (!id) { respond(undefined, 'Missing grove id'); return; }
          await this.groveManager.deleteGrove(id);
          respond(null);
          break;
        }
        case 'stopGrove': {
          const stopId = message.payload?.id as string;
          if (!stopId) { respond(undefined, 'Missing grove id'); return; }
          const stopped = await this.groveManager.stopGrove(stopId);
          respond(stopped);
          break;
        }
        case 'startGrove': {
          const startId = message.payload?.id as string;
          if (!startId) { respond(undefined, 'Missing grove id'); return; }
          const started = await this.groveManager.startGrove(startId);
          respond(started);
          break;
        }
        case 'getSshConfig': {
          const sshId = message.payload?.id as string;
          if (!sshId) { respond(undefined, 'Missing grove id'); return; }
          const config = await this.trellisClient.getSshConfig(sshId);
          respond(config);
          break;
        }
        default:
          respond(undefined, `Unknown message type: ${message.type}`);
      }
    } catch (err) {
      logger.error(`Webview message handler error (${message.type}): ${err}`);
      respond(undefined, err instanceof Error ? err.message : String(err));
    }
  }

  private postMessage(message: { type: string; success?: boolean; data?: unknown; error?: string }): void {
    this.panel?.webview.postMessage(message);
  }

  private startSseForwarding(): void {
    if (!this.sseManager) { return; }

    this.sseDisposable = this.sseManager.onGroveStateChanged((event) => {
      this.postMessage({
        type: 'groveStateChanged',
        success: true,
        data: event,
      });
    });
  }

  navigateToGrove(id: string): void {
    this.show();
    this.postMessage({
      type: 'navigateToGrove',
      success: true,
      data: { groveId: id },
    });
  }

  notifyGroveListChanged(): void {
    this.postMessage({
      type: 'groveListChanged',
      success: true,
      data: this.groveManager.getGroves(),
    });
  }

  dispose(): void {
    this.panel?.dispose();
    this.sseDisposable?.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
