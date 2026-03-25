import * as vscode from 'vscode';
import { SseClient } from '../api/sseClient';
import { AuthProvider } from '../api/auth/authProvider';
import { GroveStateChangedEvent } from '../api/types';
import * as logger from '../util/logger';

/**
 * Manages SSE connections for multiple groves.
 *
 * Each grove with a transitional state gets its own `SseClient` connection.
 * Events from all connections are aggregated into a single event stream.
 */
export class SseManager implements vscode.Disposable {
  private readonly connections = new Map<string, SseClient>();
  private readonly connectionDisposables = new Map<string, vscode.Disposable>();

  private readonly _onGroveStateChanged = new vscode.EventEmitter<GroveStateChangedEvent>();
  readonly onGroveStateChanged: vscode.Event<GroveStateChangedEvent> = this._onGroveStateChanged.event;

  constructor(
    private readonly baseUrl: string,
    private readonly authProvider: AuthProvider,
  ) {}

  /**
   * Subscribe to SSE events for the given grove.
   * If already subscribed, this is a no-op.
   */
  subscribe(groveId: string): void {
    if (this.connections.has(groveId)) {
      return;
    }

    logger.info(`SseManager: subscribing to grove ${groveId}`);

    const client = new SseClient(this.baseUrl, this.authProvider);
    const disposable = client.onGroveStateChanged((event) => {
      this._onGroveStateChanged.fire(event);
    });

    this.connections.set(groveId, client);
    this.connectionDisposables.set(groveId, disposable);

    client.connect(groveId);
  }

  /**
   * Unsubscribe from SSE events for the given grove and close the connection.
   */
  unsubscribe(groveId: string): void {
    const client = this.connections.get(groveId);
    if (client) {
      logger.info(`SseManager: unsubscribing from grove ${groveId}`);
      client.dispose();
      this.connections.delete(groveId);
    }

    const disposable = this.connectionDisposables.get(groveId);
    if (disposable) {
      disposable.dispose();
      this.connectionDisposables.delete(groveId);
    }
  }

  /**
   * Close all SSE connections.
   */
  unsubscribeAll(): void {
    for (const groveId of Array.from(this.connections.keys())) {
      this.unsubscribe(groveId);
    }
  }

  dispose(): void {
    this.unsubscribeAll();
    this._onGroveStateChanged.dispose();
  }
}
