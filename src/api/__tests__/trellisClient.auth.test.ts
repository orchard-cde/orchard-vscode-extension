import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => {
  class EventEmitter<T> {
    private listeners: Array<(e: T) => void> = [];
    event = (listener: (e: T) => void) => {
      this.listeners.push(listener);
      return { dispose: () => this.listeners.splice(this.listeners.indexOf(listener), 1) };
    };
    fire(e: T) {
      [...this.listeners].forEach((l) => l(e));
    }
    dispose() {
      this.listeners = [];
    }
  }
  class Disposable {
    constructor(private readonly fn: () => void) {}
    dispose() {
      this.fn();
    }
  }
  return {
    EventEmitter,
    Disposable,
    commands: { executeCommand: vi.fn() },
    window: { createOutputChannel: vi.fn(() => ({ appendLine: vi.fn() })) },
  };
});

import { AuthManager } from '../auth/authManager';
import type { FenceClient } from '../auth/fenceClient';
import { SessionStore, type StoredSession } from '../auth/sessionStore';
import { TrellisClient } from '../trellisClient';
import { fakeSecrets } from '../../__tests__/helpers';

const SERVER = 'https://trellis.example.com';
const ISSUER = 'https://fence.example.com';
const NOW = 1_000_000;

describe('TrellisClient with a real AuthManager', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('the first request during an un-awaited initialize() carries the stored bearer and prompts no sign-in', async () => {
    const stored: StoredSession = {
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: NOW + 3600,
      issuer: ISSUER,
      account: { id: 'u1', label: 'user@example.com' },
    };
    const store = new SessionStore(
      fakeSecrets({ [`orchard.session:${SERVER}`]: JSON.stringify(stored) }).secrets,
    );
    const manager = new AuthManager({
      serverUrl: SERVER,
      store,
      fence: {} as FenceClient,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ issuer: ISSUER }), { status: 200 })) as typeof fetch,
      now: () => NOW,
    });
    let signInRequests = 0;
    manager.onDidRequireSignIn(() => signInRequests++);

    const trellisFetch = vi.fn(async (_url: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === 'Bearer access-1'
        ? new Response(JSON.stringify([]), { status: 200 })
        : new Response(JSON.stringify({ message: 'unauthorized' }), { status: 401 });
    });
    vi.stubGlobal('fetch', trellisFetch);

    const init = manager.initialize();
    await expect(new TrellisClient(SERVER, manager).listGroves()).resolves.toEqual([]);
    await init;

    expect(trellisFetch).toHaveBeenCalledTimes(1);
    expect((trellisFetch.mock.calls[0][1].headers as Record<string, string>).Authorization).toBe(
      'Bearer access-1',
    );
    expect(signInRequests).toBe(0);
    manager.dispose();
  });
});
