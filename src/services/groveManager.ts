import * as vscode from 'vscode';
import { TrellisClient } from '../api/trellisClient';
import { CreateGroveRequest, GroveResponse } from '../api/types';
import { getAutoRefreshInterval } from '../util/configuration';

export class GroveManager implements vscode.Disposable {
  private readonly groves = new Map<string, GroveResponse>();
  private pollingTimer: ReturnType<typeof setInterval> | undefined;

  private readonly _onDidChangeGroves = new vscode.EventEmitter<void>();
  readonly onDidChangeGroves: vscode.Event<void> = this._onDidChangeGroves.event;

  constructor(private readonly trellisClient: TrellisClient) {}

  /** Fetch the full grove list from the API and update the local cache. */
  async refresh(): Promise<void> {
    const list = await this.trellisClient.listGroves();
    this.groves.clear();
    for (const grove of list) {
      this.groves.set(grove.id, grove);
    }
    this._onDidChangeGroves.fire();
  }

  /** Return all cached groves sorted by name. */
  getGroves(): GroveResponse[] {
    return Array.from(this.groves.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }

  /** Return a single cached grove by id, or undefined. */
  getGrove(id: string): GroveResponse | undefined {
    return this.groves.get(id);
  }

  /** Create a new grove via the API, add it to the cache, and fire the change event. */
  async createGrove(request: CreateGroveRequest): Promise<GroveResponse> {
    const grove = await this.trellisClient.createGrove(request);
    this.groves.set(grove.id, grove);
    this._onDidChangeGroves.fire();
    return grove;
  }

  /** Delete a grove via the API, remove it from the cache, and fire the change event. */
  async deleteGrove(id: string): Promise<void> {
    await this.trellisClient.deleteGrove(id);
    this.groves.delete(id);
    this._onDidChangeGroves.fire();
  }

  /** Stop a grove via the API, update the cache, and fire the change event. */
  async stopGrove(id: string): Promise<GroveResponse> {
    const grove = await this.trellisClient.stopGrove(id);
    this.groves.set(grove.id, grove);
    this._onDidChangeGroves.fire();
    return grove;
  }

  /** Start a grove via the API, update the cache, and fire the change event. */
  async startGrove(id: string): Promise<GroveResponse> {
    const grove = await this.trellisClient.startGrove(id);
    this.groves.set(grove.id, grove);
    this._onDidChangeGroves.fire();
    return grove;
  }

  /** Begin polling for grove list changes at the configured interval. */
  startPolling(): void {
    this.stopPolling();
    const intervalMs = getAutoRefreshInterval() * 1000;
    this.pollingTimer = setInterval(() => {
      this.refresh().catch(() => {
        // Silently ignore polling errors; the next tick will retry.
      });
    }, intervalMs);
  }

  /** Stop the polling timer if running. */
  stopPolling(): void {
    if (this.pollingTimer !== undefined) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = undefined;
    }
  }

  dispose(): void {
    this.stopPolling();
    this._onDidChangeGroves.dispose();
  }
}
