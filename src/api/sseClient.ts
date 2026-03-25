import * as vscode from 'vscode';
import EventSource from 'eventsource';
import { AuthProvider } from './auth/authProvider';
import { GroveStateChangedEvent } from './types';
import * as logger from '../util/logger';

/**
 * SSE client for a single grove's real-time state updates.
 *
 * Connects to the Trellis SSE endpoint and emits parsed
 * `GroveStateChangedEvent` objects whenever the grove state changes.
 */
export class SseClient implements vscode.Disposable {
  private eventSource: EventSource | undefined;
  private reconnectDelay = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private groveId: string | undefined;

  private static readonly MAX_RECONNECT_DELAY = 30_000;

  private readonly _onGroveStateChanged = new vscode.EventEmitter<GroveStateChangedEvent>();
  readonly onGroveStateChanged: vscode.Event<GroveStateChangedEvent> = this._onGroveStateChanged.event;

  constructor(
    private readonly baseUrl: string,
    private readonly _authProvider: AuthProvider,
  ) {}

  /**
   * Open an EventSource connection for the given grove.
   *
   * NOTE: The standard EventSource API does not support custom headers.
   * For V1 (unauthenticated SSE) we connect without auth headers.
   * When auth is required for SSE, consider using a polyfill that supports
   * custom headers or pass credentials via query parameters.
   */
  connect(groveId: string): void {
    this.close();
    this.groveId = groveId;
    this.reconnectDelay = 1000;
    this.openConnection();
  }

  close(): void {
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = undefined;
    }
    this.groveId = undefined;
  }

  dispose(): void {
    this.close();
    this._onGroveStateChanged.dispose();
  }

  private openConnection(): void {
    if (!this.groveId) {
      return;
    }

    const url = `${this.baseUrl}/api/groves/${this.groveId}/events`;
    logger.info(`SSE: connecting to ${url}`);

    this.eventSource = new EventSource(url);

    this.eventSource.addEventListener('grove-state-changed', (event) => {
      try {
        const data = JSON.parse(event.data) as GroveStateChangedEvent;
        logger.info(
          `SSE: grove ${data.groveId} state changed: ${data.previousState} → ${data.newState}`,
        );
        this.reconnectDelay = 1000; // Reset backoff on successful event
        this._onGroveStateChanged.fire(data);
      } catch (err) {
        logger.warn(`SSE: failed to parse event data: ${err}`);
      }
    });

    this.eventSource.onerror = () => {
      logger.warn(
        `SSE: connection error for grove ${this.groveId}, reconnecting in ${this.reconnectDelay}ms`,
      );

      // Close the current broken connection
      if (this.eventSource) {
        this.eventSource.close();
        this.eventSource = undefined;
      }

      // Schedule reconnect with exponential backoff
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = undefined;
        this.openConnection();
      }, this.reconnectDelay);

      this.reconnectDelay = Math.min(
        this.reconnectDelay * 2,
        SseClient.MAX_RECONNECT_DELAY,
      );
    };

    this.eventSource.onopen = () => {
      logger.info(`SSE: connected for grove ${this.groveId}`);
      this.reconnectDelay = 1000; // Reset backoff on successful connection
    };
  }
}
