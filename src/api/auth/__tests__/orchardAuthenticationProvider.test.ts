import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => {
  class EventEmitter<T> {
    private listeners: Array<(e: T) => void> = [];
    get event() {
      return (listener: (e: T) => void) => {
        this.listeners.push(listener);
        return {
          dispose: () => {
            const i = this.listeners.indexOf(listener);
            if (i >= 0) this.listeners.splice(i, 1);
          },
        };
      };
    }
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
  return { EventEmitter, Disposable };
});

import * as vscode from 'vscode';
import type { AuthManager, SessionChange } from '../authManager';
import type { StoredSession } from '../sessionStore';
import { OrchardAuthenticationProvider, toSession } from '../orchardAuthenticationProvider';

const SERVER = 'https://orchard.example.com';

function stored(id: string, token = `token-${id}`): StoredSession {
  return {
    accessToken: token,
    refreshToken: `refresh-${id}`,
    expiresAt: 1_000,
    issuer: 'https://fence.example.com',
    account: { id, label: `${id}@example.com` },
  };
}

class FakeManager {
  readonly emitter = new vscode.EventEmitter<SessionChange>();
  readonly onDidChangeSession = this.emitter.event;
  session: StoredSession | undefined;
  signIn = vi.fn(async () => {
    this.session = this.session ?? stored('alice');
    return this.session;
  });
  signOut = vi.fn(async () => {
    this.session = undefined;
  });
  constructor(
    readonly serverUrl: string = SERVER,
    session?: StoredSession,
  ) {
    this.session = session;
  }
  getSession() {
    return this.session;
  }
  asManager(): AuthManager {
    return this as unknown as AuthManager;
  }
}

type ChangeEvent = vscode.AuthenticationProviderAuthenticationSessionsChangeEvent;

function collect(provider: OrchardAuthenticationProvider): ChangeEvent[] {
  const events: ChangeEvent[] = [];
  provider.onDidChangeSessions((e) => events.push(e));
  return events;
}

describe('toSession', () => {
  it('derives a stable id, scopes ["openid"], account from the stored record', () => {
    const s = stored('alice');
    const result = toSession(`${SERVER}/`, s);
    expect(result).toEqual({
      id: `alice@${SERVER}`,
      accessToken: 'token-alice',
      account: { id: 'alice', label: 'alice@example.com' },
      scopes: ['openid'],
    });
    expect(toSession(SERVER, { ...s, accessToken: 'rotated' }).id).toBe(result.id);
  });
});

describe('OrchardAuthenticationProvider', () => {
  it('getSessions returns [] with no manager or no session, [session] otherwise, ignoring scopes', async () => {
    const provider = new OrchardAuthenticationProvider();
    expect(await provider.getSessions()).toEqual([]);

    const manager = new FakeManager();
    provider.setManager(manager.asManager());
    expect(await provider.getSessions(['openid'])).toEqual([]);

    manager.session = stored('alice');
    const expected = toSession(SERVER, manager.session);
    expect(await provider.getSessions()).toEqual([expected]);
    expect(await provider.getSessions(['something-else'])).toEqual([expected]);
  });

  it('createSession delegates to manager.signIn and returns the mapped session', async () => {
    const provider = new OrchardAuthenticationProvider();
    await expect(provider.createSession(['openid'])).rejects.toThrow('Orchard is not configured');

    const manager = new FakeManager();
    provider.setManager(manager.asManager());
    const session = await provider.createSession(['openid']);
    expect(manager.signIn).toHaveBeenCalledTimes(1);
    expect(session).toEqual(toSession(SERVER, stored('alice')));
  });

  it('removeSession calls signOut only when the id matches', async () => {
    const provider = new OrchardAuthenticationProvider();
    await provider.removeSession('alice@x');

    const manager = new FakeManager(SERVER, stored('alice'));
    provider.setManager(manager.asManager());
    await provider.removeSession('bob@' + SERVER);
    expect(manager.signOut).not.toHaveBeenCalled();

    await provider.removeSession(`alice@${SERVER}`);
    expect(manager.signOut).toHaveBeenCalledTimes(1);

    await provider.removeSession(`alice@${SERVER}`);
    expect(manager.signOut).toHaveBeenCalledTimes(1);
  });

  it('manager added/removed events map to {added:[s]} / {removed:[s]}', () => {
    const provider = new OrchardAuthenticationProvider();
    const manager = new FakeManager();
    provider.setManager(manager.asManager());
    const events = collect(provider);

    const s = stored('alice');
    manager.emitter.fire({ added: s });
    manager.emitter.fire({ removed: s });

    expect(events).toEqual([{ added: [toSession(SERVER, s)] }, { removed: [toSession(SERVER, s)] }]);
  });

  it('setManager fires removed for the old session then added for the new one', () => {
    const provider = new OrchardAuthenticationProvider();
    const oldSession = stored('alice');
    const newSession = stored('bob');
    const oldManager = new FakeManager(SERVER, oldSession);
    const newManager = new FakeManager('https://other.example.com', newSession);
    provider.setManager(oldManager.asManager());
    const events = collect(provider);

    provider.setManager(newManager.asManager());

    expect(events).toEqual([
      { removed: [toSession(SERVER, oldSession)] },
      { added: [toSession('https://other.example.com', newSession)] },
    ]);
  });

  it('setManager disposes the subscription to the previous manager', () => {
    const provider = new OrchardAuthenticationProvider();
    const oldManager = new FakeManager();
    provider.setManager(oldManager.asManager());
    provider.setManager(new FakeManager('https://other.example.com').asManager());
    const events = collect(provider);

    oldManager.emitter.fire({ added: stored('alice') });

    expect(events).toEqual([]);
  });

  it('setManager(undefined) fires removed for the old session and detaches', async () => {
    const provider = new OrchardAuthenticationProvider();
    const manager = new FakeManager(SERVER, stored('alice'));
    provider.setManager(manager.asManager());
    const events = collect(provider);

    provider.setManager(undefined);
    manager.emitter.fire({ added: stored('bob') });

    expect(events).toEqual([{ removed: [toSession(SERVER, stored('alice'))] }]);
    expect(await provider.getSessions()).toEqual([]);
  });

  it('dispose detaches from the manager and stops events', () => {
    const provider = new OrchardAuthenticationProvider();
    const manager = new FakeManager();
    provider.setManager(manager.asManager());
    const events = collect(provider);

    provider.dispose();
    manager.emitter.fire({ added: stored('alice') });

    expect(events).toEqual([]);
  });
});
