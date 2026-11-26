import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
  return {
    EventEmitter,
    Disposable,
    commands: { executeCommand: vi.fn() },
    window: {
      createOutputChannel: vi.fn(() => ({ appendLine: vi.fn() })),
      showInformationMessage: vi.fn(),
    },
  };
});

import * as vscode from 'vscode';
import { AuthManager, type SessionChange } from '../authManager';
import {
  FenceClient,
  FenceError,
  FenceTransportError,
  type FenceEndpoints,
  type TokenResponse,
} from '../fenceClient';
import { SessionStore, type StoredSession } from '../sessionStore';

const SERVER = 'https://trellis.example.com/';
const SERVER_NORM = 'https://trellis.example.com';
const ISSUER = 'https://fence.example.com';
const NOW = 1_000_000;

const endpoints: FenceEndpoints = {
  deviceAuthorizationEndpoint: `${ISSUER}/oauth2/device_authorization`,
  tokenEndpoint: `${ISSUER}/oauth2/token`,
};

function session(overrides: Partial<StoredSession> = {}): StoredSession {
  return {
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresAt: NOW + 3600,
    issuer: ISSUER,
    account: { id: 'u1', label: 'user@example.com' },
    ...overrides,
  };
}

function fakeSecrets() {
  const data = new Map<string, string>();
  const listeners: Array<(e: { key: string }) => void> = [];
  const secrets = {
    get: vi.fn(async (key: string) => data.get(key)),
    store: async (key: string, value: string) => {
      data.set(key, value);
      listeners.forEach((l) => l({ key }));
    },
    delete: async (key: string) => {
      data.delete(key);
      listeners.forEach((l) => l({ key }));
    },
    onDidChange: (listener: (e: { key: string }) => void) => {
      listeners.push(listener);
      return {
        dispose: () => {
          const i = listeners.indexOf(listener);
          if (i >= 0) listeners.splice(i, 1);
        },
      };
    },
  };
  return { data, secrets, listeners };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function configFetch(make: () => Response = () => json({ issuer: ISSUER })) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => make());
}

function tokens(access: string, refresh?: string, expiresIn = 3600): TokenResponse {
  return { accessToken: access, refreshToken: refresh, expiresIn };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function contextValues(key: string): unknown[] {
  return vi
    .mocked(vscode.commands.executeCommand)
    .mock.calls.filter((c) => c[0] === 'setContext' && c[1] === key)
    .map((c) => c[2]);
}

function lastContext(key: string): unknown {
  return contextValues(key).at(-1);
}

interface Setup {
  stored?: StoredSession;
  fetchImpl?: ReturnType<typeof configFetch>;
  mock?: boolean;
}

function setup(opts: Setup = {}) {
  const { data, secrets, listeners } = fakeSecrets();
  const vsSecrets = secrets as unknown as vscode.SecretStorage;
  const store = new SessionStore(vsSecrets);
  const otherWindow = new SessionStore(vsSecrets);
  if (opts.stored) data.set(`orchard.session:${SERVER_NORM}`, JSON.stringify(opts.stored));
  const fence = {
    discover: vi.fn(async (_issuer: string) => endpoints),
    refresh: vi.fn<(e: FenceEndpoints, rt: string) => Promise<TokenResponse>>(),
    requestDeviceAuthorization: vi.fn(),
    pollDeviceToken: vi.fn(),
  };
  const fetchImpl = opts.fetchImpl ?? configFetch();
  let now = NOW;
  const manager = new AuthManager({
    serverUrl: SERVER,
    store,
    fence: fence as unknown as FenceClient,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    mock: opts.mock,
    now: () => now,
  });
  const changes: SessionChange[] = [];
  let authChanges = 0;
  let signInRequests = 0;
  manager.onDidChangeSession((e) => changes.push(e));
  manager.onDidChangeAuthentication(() => authChanges++);
  manager.onDidRequireSignIn(() => signInRequests++);
  return {
    manager,
    store,
    otherWindow,
    secrets,
    listeners,
    fence,
    fetchImpl,
    changes,
    authChanges: () => authChanges,
    signInRequests: () => signInRequests,
    advance: (seconds: number) => {
      now += seconds;
    },
    persisted: () => store.read(SERVER_NORM),
  };
}

beforeEach(() => {
  vi.mocked(vscode.commands.executeCommand).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('initialize', () => {
  it('with a pre-populated secret: getSession() is set, orchard.signedIn=true, onDidChangeSession fires {added}', async () => {
    const s = setup({ stored: session() });
    await s.manager.initialize();
    expect(s.manager.getSession()).toEqual(session());
    expect(lastContext('orchard.signedIn')).toBe(true);
    expect(s.changes).toEqual([{ added: session() }]);
    expect(s.authChanges()).toBe(1);
    expect(s.manager.serverUrl).toBe(SERVER_NORM);
  });

  it('with no secret: getSession() undefined, orchard.signedIn=false, no event', async () => {
    const s = setup();
    await s.manager.initialize();
    expect(s.manager.getSession()).toBeUndefined();
    expect(lastContext('orchard.signedIn')).toBe(false);
    expect(s.changes).toEqual([]);
    expect(s.authChanges()).toBe(0);
  });

  it('constructor alone reads nothing from the store', async () => {
    const s = setup({ stored: session() });
    await flush();
    expect(s.secrets.get).not.toHaveBeenCalled();
    expect(s.fetchImpl).not.toHaveBeenCalled();
    expect(s.manager.getSession()).toBeUndefined();
  });

  it('deletes a stored session whose issuer differs from the live issuer', async () => {
    const s = setup({ stored: session({ issuer: 'https://old-fence.example.com' }) });
    await s.manager.initialize();
    expect(s.manager.getSession()).toBeUndefined();
    expect(await s.persisted()).toBeUndefined();
    expect(lastContext('orchard.signedIn')).toBe(false);
    expect(s.changes).toEqual([]);
  });
});

describe('store changes from another window', () => {
  it('rotation (same account, new tokens) updates the in-memory record and fires no session or auth event', async () => {
    const s = setup({ stored: session() });
    await s.manager.initialize();
    const rotated = session({ accessToken: 'access-2', refreshToken: 'refresh-2' });
    await s.otherWindow.write(SERVER_NORM, rotated);
    await flush();
    expect(s.manager.getSession()).toEqual(rotated);
    expect(s.changes).toEqual([{ added: session() }]);
    expect(s.authChanges()).toBe(1);
  });

  it('deletion by another window clears the record, sets signedIn=false, fires {removed} and onDidChangeAuthentication', async () => {
    const s = setup({ stored: session() });
    await s.manager.initialize();
    await s.otherWindow.delete(SERVER_NORM);
    await flush();
    expect(s.manager.getSession()).toBeUndefined();
    expect(lastContext('orchard.signedIn')).toBe(false);
    expect(s.changes.at(-1)).toEqual({ removed: session() });
    expect(s.authChanges()).toBe(2);
  });

  it('appearance by another window hydrates, sets signedIn=true, fires {added} and onDidChangeAuthentication', async () => {
    const s = setup();
    await s.manager.initialize();
    await s.otherWindow.write(SERVER_NORM, session());
    await flush();
    expect(s.manager.getSession()).toEqual(session());
    expect(lastContext('orchard.signedIn')).toBe(true);
    expect(s.changes).toEqual([{ added: session() }]);
    expect(s.authChanges()).toBe(1);
  });

  it('dispose() unsubscribes from the store', async () => {
    const s = setup();
    await s.manager.initialize();
    expect(s.listeners).toHaveLength(1);
    s.manager.dispose();
    expect(s.listeners).toHaveLength(0);
    await s.otherWindow.write(SERVER_NORM, session());
    await flush();
    expect(s.manager.getSession()).toBeUndefined();
    expect(s.changes).toEqual([]);
  });
});

describe('mode discovery', () => {
  it('issuer null → disabled; getHeaders is {} and fence is never called', async () => {
    const s = setup({ stored: session(), fetchImpl: configFetch(() => json({ issuer: null })) });
    expect(await s.manager.getHeaders()).toEqual({});
    expect(s.manager.getMode()).toBe('disabled');
    expect(await s.manager.isAuthenticated()).toBe(false);
    expect(s.fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(s.fetchImpl.mock.calls[0][0])).toBe(`${SERVER_NORM}/api/auth/config`);
    expect(s.fence.discover).not.toHaveBeenCalled();
    expect(s.fence.refresh).not.toHaveBeenCalled();
  });

  it('issuer present → enabled; discover is called lazily on first need', async () => {
    const s = setup({ stored: session() });
    expect(s.manager.getMode()).toBe('unknown');
    await s.manager.initialize();
    expect(s.manager.getMode()).toBe('enabled');
    expect(await s.manager.getHeaders()).toEqual({ Authorization: 'Bearer access-1' });
    expect(s.fence.discover).not.toHaveBeenCalled();

    s.advance(3600);
    s.fence.refresh.mockResolvedValueOnce(tokens('access-2', 'refresh-2'));
    expect(await s.manager.getHeaders()).toEqual({ Authorization: 'Bearer access-2' });
    expect(s.fence.discover).toHaveBeenCalledWith(ISSUER);
    expect(s.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('auth/config 404 or HTML → unknown; getHeaders {}; retried on next getHeaders only after 60 s', async () => {
    const responses = [
      () => new Response('not found', { status: 404 }),
      () => new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
      () => json({ issuer: ISSUER }),
    ];
    let i = 0;
    const s = setup({ stored: session(), fetchImpl: configFetch(() => responses[i++]()) });

    expect(await s.manager.getHeaders()).toEqual({});
    expect(s.manager.getMode()).toBe('unknown');
    expect(await s.manager.getHeaders()).toEqual({});
    expect(s.fetchImpl).toHaveBeenCalledTimes(1);

    s.advance(60);
    expect(await s.manager.getHeaders()).toEqual({});
    expect(s.manager.getMode()).toBe('unknown');
    expect(s.fetchImpl).toHaveBeenCalledTimes(2);

    s.advance(59);
    expect(await s.manager.getHeaders()).toEqual({});
    expect(s.fetchImpl).toHaveBeenCalledTimes(2);

    s.advance(1);
    expect(await s.manager.getHeaders()).toEqual({ Authorization: 'Bearer access-1' });
    expect(s.manager.getMode()).toBe('enabled');
    expect(s.fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('missing issuer key → unknown', async () => {
    const s = setup({ fetchImpl: configFetch(() => json({})) });
    await s.manager.initialize();
    expect(s.manager.getMode()).toBe('unknown');
  });

  it('mock: true → disabled with no fetch at all', async () => {
    const s = setup({ mock: true, stored: session() });
    expect(s.manager.getMode()).toBe('disabled');
    await s.manager.initialize();
    expect(await s.manager.getHeaders()).toEqual({});
    expect(s.manager.getMode()).toBe('disabled');
    expect(s.fetchImpl).not.toHaveBeenCalled();
    expect(s.fence.refresh).not.toHaveBeenCalled();
  });
});

describe('getHeaders', () => {
  it('returns Bearer when expiresAt - 30 > now', async () => {
    const s = setup({ stored: session({ expiresAt: NOW + 31 }) });
    await s.manager.initialize();
    expect(await s.manager.getHeaders()).toEqual({ Authorization: 'Bearer access-1' });
    expect(await s.manager.isAuthenticated()).toBe(true);
    expect(s.fence.refresh).not.toHaveBeenCalled();
  });

  it('reads the store when there is no in-memory session', async () => {
    const s = setup();
    await s.manager.initialize();
    expect(await s.manager.getHeaders()).toEqual({});
    s.secrets.get.mockClear();
    expect(await s.manager.getHeaders()).toEqual({});
    expect(s.secrets.get).toHaveBeenCalledTimes(1);
  });

  it('refreshes when within 30 s of expiry and persists new access, refresh, expiresAt before resolving', async () => {
    const s = setup({ stored: session({ expiresAt: NOW + 30 }) });
    await s.manager.initialize();
    s.fence.refresh.mockResolvedValueOnce(tokens('access-2', 'refresh-2', 600));
    expect(await s.manager.getHeaders()).toEqual({ Authorization: 'Bearer access-2' });
    expect(s.fence.refresh).toHaveBeenCalledWith(endpoints, 'refresh-1');
    const expected = session({ accessToken: 'access-2', refreshToken: 'refresh-2', expiresAt: NOW + 600 });
    expect(await s.persisted()).toEqual(expected);
    expect(s.manager.getSession()).toEqual(expected);
    await flush();
    expect(s.changes).toEqual([{ added: session({ expiresAt: NOW + 30 }) }]);
  });

  it('keeps the old refresh token when the response omits one', async () => {
    const s = setup({ stored: session({ expiresAt: NOW }) });
    await s.manager.initialize();
    s.fence.refresh.mockResolvedValueOnce(tokens('access-2', undefined, 600));
    expect(await s.manager.getHeaders()).toEqual({ Authorization: 'Bearer access-2' });
    expect(await s.persisted()).toEqual(
      session({ accessToken: 'access-2', refreshToken: 'refresh-1', expiresAt: NOW + 600 }),
    );
  });

  it('concurrent callers share one refresh (fence.refresh called once)', async () => {
    const s = setup({ stored: session({ expiresAt: NOW }) });
    await s.manager.initialize();
    let resolve!: (t: TokenResponse) => void;
    s.fence.refresh.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    const calls = [s.manager.getHeaders(), s.manager.getHeaders(), s.manager.getHeaders()];
    await flush();
    resolve(tokens('access-2', 'refresh-2'));
    expect(await Promise.all(calls)).toEqual([
      { Authorization: 'Bearer access-2' },
      { Authorization: 'Bearer access-2' },
      { Authorization: 'Bearer access-2' },
    ]);
    expect(s.fence.refresh).toHaveBeenCalledTimes(1);

    s.advance(3600);
    s.fence.refresh.mockResolvedValueOnce(tokens('access-3', 'refresh-3'));
    expect(await s.manager.getHeaders()).toEqual({ Authorization: 'Bearer access-3' });
    expect(s.fence.refresh).toHaveBeenCalledTimes(2);
    expect(s.fence.refresh).toHaveBeenLastCalledWith(endpoints, 'refresh-2');
  });

  it('invalidate() forces a refresh on the next call', async () => {
    const s = setup({ stored: session() });
    await s.manager.initialize();
    s.manager.invalidate();
    s.fence.refresh.mockResolvedValueOnce(tokens('access-2', 'refresh-2'));
    expect(await s.manager.getHeaders()).toEqual({ Authorization: 'Bearer access-2' });
    expect(await s.manager.getHeaders()).toEqual({ Authorization: 'Bearer access-2' });
    expect(s.fence.refresh).toHaveBeenCalledTimes(1);
  });

  it('issuer mismatch between stored session and live issuer deletes the session and returns {}', async () => {
    const responses = [() => new Response('down', { status: 503 }), () => json({ issuer: ISSUER })];
    let i = 0;
    const stale = session({ issuer: 'https://old-fence.example.com' });
    const s = setup({ stored: stale, fetchImpl: configFetch(() => responses[i++]()) });
    await s.manager.initialize();
    expect(s.manager.getSession()).toEqual(stale);

    s.advance(60);
    expect(await s.manager.getHeaders()).toEqual({});
    expect(s.manager.getMode()).toBe('enabled');
    expect(await s.persisted()).toBeUndefined();
    expect(s.manager.getSession()).toBeUndefined();
    await flush();
    expect(s.changes).toEqual([{ added: stale }, { removed: stale }]);
    expect(lastContext('orchard.signedIn')).toBe(false);
    expect(s.fence.refresh).not.toHaveBeenCalled();
  });
});

describe('invalid_grant', () => {
  it('stored token differs from the failed one → adopts stored, no delete; unexpired → Bearer', async () => {
    const s = setup({ stored: session({ expiresAt: NOW }) });
    await s.manager.initialize();
    const fresh = session({ accessToken: 'access-other', refreshToken: 'refresh-other' });
    s.fence.refresh.mockImplementationOnce(async () => {
      s.listeners.length = 0;
      await s.otherWindow.write(SERVER_NORM, fresh);
      throw new FenceError('invalid_grant');
    });
    expect(await s.manager.getHeaders()).toEqual({ Authorization: 'Bearer access-other' });
    expect(s.manager.getSession()).toEqual(fresh);
    expect(await s.persisted()).toEqual(fresh);
    expect(s.fence.refresh).toHaveBeenCalledTimes(1);
    expect(s.changes).toEqual([{ added: session({ expiresAt: NOW }) }]);
  });

  it('stored token differs and is expired → retries once with the adopted token', async () => {
    const s = setup({ stored: session({ expiresAt: NOW }) });
    await s.manager.initialize();
    const moved = session({ accessToken: 'access-other', refreshToken: 'refresh-other', expiresAt: NOW });
    s.fence.refresh
      .mockImplementationOnce(async () => {
        await s.otherWindow.write(SERVER_NORM, moved);
        throw new FenceError('invalid_grant');
      })
      .mockResolvedValueOnce(tokens('access-3', 'refresh-3'));
    expect(await s.manager.getHeaders()).toEqual({ Authorization: 'Bearer access-3' });
    expect(s.fence.refresh).toHaveBeenNthCalledWith(1, endpoints, 'refresh-1');
    expect(s.fence.refresh).toHaveBeenNthCalledWith(2, endpoints, 'refresh-other');
    expect(await s.persisted()).toEqual(
      session({ accessToken: 'access-3', refreshToken: 'refresh-3', expiresAt: NOW + 3600 }),
    );
  });

  it('retry fails but the store moved on again → adopts, no delete', async () => {
    const s = setup({ stored: session({ expiresAt: NOW }) });
    await s.manager.initialize();
    const moved = session({ accessToken: 'access-b', refreshToken: 'refresh-b', expiresAt: NOW });
    const movedAgain = session({ accessToken: 'access-c', refreshToken: 'refresh-c', expiresAt: NOW });
    s.fence.refresh
      .mockImplementationOnce(async () => {
        await s.otherWindow.write(SERVER_NORM, moved);
        throw new FenceError('invalid_grant');
      })
      .mockImplementationOnce(async () => {
        await s.otherWindow.write(SERVER_NORM, movedAgain);
        throw new FenceError('invalid_grant');
      });
    expect(await s.manager.getHeaders()).toEqual({});
    expect(s.fence.refresh).toHaveBeenCalledTimes(2);
    expect(await s.persisted()).toEqual(movedAgain);
    expect(s.manager.getSession()).toEqual(movedAgain);
    await flush();
    expect(s.changes.some((c) => c.removed)).toBe(false);
  });

  it('stored token equals the failed one → deletes, fires removed, signedIn=false', async () => {
    const s = setup({ stored: session({ expiresAt: NOW }) });
    await s.manager.initialize();
    vi.useFakeTimers();
    s.fence.refresh.mockRejectedValueOnce(new FenceError('invalid_grant'));
    const headers = s.manager.getHeaders();
    await vi.advanceTimersByTimeAsync(1999);
    expect(await s.persisted()).toEqual(session({ expiresAt: NOW }));
    await vi.advanceTimersByTimeAsync(1);
    expect(await headers).toEqual({});
    expect(await s.persisted()).toBeUndefined();
    expect(s.manager.getSession()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.changes).toEqual([{ added: session({ expiresAt: NOW }) }, { removed: session({ expiresAt: NOW }) }]);
    expect(s.authChanges()).toBe(2);
    expect(lastContext('orchard.signedIn')).toBe(false);
  });
});

describe('concurrent rotation across windows', () => {
  it('two windows refresh with the same token: the loser waits, re-reads, adopts the winner\'s rotation and does not delete', async () => {
    const s = setup({ stored: session({ expiresAt: NOW }) });
    await s.manager.initialize();
    vi.useFakeTimers();
    s.fence.refresh.mockRejectedValueOnce(new FenceError('invalid_grant'));
    let settled = false;
    const headers = s.manager.getHeaders().finally(() => (settled = true));
    await vi.advanceTimersByTimeAsync(1000);
    expect(settled).toBe(false);
    const winner = session({ accessToken: 'access-w', refreshToken: 'refresh-w' });
    await s.otherWindow.write(SERVER_NORM, winner);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await headers).toEqual({ Authorization: 'Bearer access-w' });
    expect(await s.persisted()).toEqual(winner);
    expect(s.manager.getSession()).toEqual(winner);
    expect(s.fence.refresh).toHaveBeenCalledTimes(1);
    expect(s.changes.some((c) => c.removed)).toBe(false);
  });

  it('a refresh completing after another window deleted the session still persists the rotated tokens', async () => {
    const s = setup({ stored: session({ expiresAt: NOW }) });
    await s.manager.initialize();
    const pending = deferred<TokenResponse>();
    s.fence.refresh.mockReturnValueOnce(pending.promise);
    const headers = s.manager.getHeaders();
    await flush();
    await s.otherWindow.delete(SERVER_NORM);
    await flush();
    expect(s.manager.getSession()).toBeUndefined();
    pending.resolve(tokens('access-2', 'refresh-2', 600));
    expect(await headers).toEqual({ Authorization: 'Bearer access-2' });
    const rotated = session({ accessToken: 'access-2', refreshToken: 'refresh-2', expiresAt: NOW + 600 });
    expect(await s.persisted()).toEqual(rotated);
    expect(s.manager.getSession()).toEqual(rotated);
    await flush();
    expect(s.changes).toEqual([
      { added: session({ expiresAt: NOW }) },
      { removed: session({ expiresAt: NOW }) },
      { added: rotated },
    ]);
    expect(lastContext('orchard.signedIn')).toBe(true);
  });

  it('a refresh completing after a local signOut discards its result and writes nothing', async () => {
    const s = setup({ stored: session({ expiresAt: NOW }) });
    await s.manager.initialize();
    const pending = deferred<TokenResponse>();
    s.fence.refresh.mockReturnValueOnce(pending.promise);
    const headers = s.manager.getHeaders();
    await flush();
    await s.manager.signOut();
    pending.resolve(tokens('access-2', 'refresh-2'));
    expect(await headers).toEqual({});
    await flush();
    expect(await s.persisted()).toBeUndefined();
    expect(s.manager.getSession()).toBeUndefined();
    expect(s.changes).toEqual([
      { added: session({ expiresAt: NOW }) },
      { removed: session({ expiresAt: NOW }) },
    ]);
    expect(lastContext('orchard.signedIn')).toBe(false);
  });
});

describe('transport failure', () => {
  it('keeps an unexpired access token and never deletes', async () => {
    const s = setup({ stored: session({ expiresAt: NOW + 10 }) });
    await s.manager.initialize();
    s.fence.refresh.mockRejectedValueOnce(new FenceTransportError('down'));
    expect(await s.manager.getHeaders()).toEqual({ Authorization: 'Bearer access-1' });
    expect(await s.persisted()).toEqual(session({ expiresAt: NOW + 10 }));
    expect(s.manager.getSession()).toEqual(session({ expiresAt: NOW + 10 }));
  });

  it('returns {} when the token is expired, still no delete', async () => {
    const s = setup({ stored: session({ expiresAt: NOW }) });
    await s.manager.initialize();
    s.fence.refresh.mockRejectedValueOnce(new FenceTransportError('down'));
    expect(await s.manager.getHeaders()).toEqual({});
    expect(await s.persisted()).toEqual(session({ expiresAt: NOW }));
    expect(s.manager.getSession()).toEqual(session({ expiresAt: NOW }));
    expect(s.changes).toEqual([{ added: session({ expiresAt: NOW }) }]);
  });

  it('fence discovery failure is treated like a transport failure', async () => {
    const s = setup({ stored: session({ expiresAt: NOW + 10 }) });
    await s.manager.initialize();
    s.fence.discover.mockRejectedValueOnce(new FenceTransportError('down'));
    expect(await s.manager.getHeaders()).toEqual({ Authorization: 'Bearer access-1' });
    expect(await s.persisted()).toEqual(session({ expiresAt: NOW + 10 }));
  });
});

describe('reporting', () => {
  it('reportUnauthorized in disabled/unknown mode does nothing', async () => {
    const disabled = setup({ stored: session(), fetchImpl: configFetch(() => json({ issuer: null })) });
    await disabled.manager.initialize();
    await disabled.manager.reportUnauthorized({ tokenRejected: true });
    expect(contextValues('orchard.authRequired')).toEqual([]);
    expect(disabled.signInRequests()).toBe(0);
    expect(await disabled.persisted()).toEqual(session());

    const unknown = setup({ stored: session(), fetchImpl: configFetch(() => new Response('x', { status: 500 })) });
    await unknown.manager.initialize();
    await unknown.manager.reportUnauthorized({ tokenRejected: true });
    expect(contextValues('orchard.authRequired')).toEqual([]);
    expect(unknown.signInRequests()).toBe(0);
    expect(await unknown.persisted()).toEqual(session());
  });

  it('reportUnauthorized sets authRequired=true and fires onDidRequireSignIn once until sign-in succeeds', async () => {
    const s = setup();
    await s.manager.initialize();
    await s.manager.reportUnauthorized({ tokenRejected: false });
    await s.manager.reportUnauthorized({ tokenRejected: false });
    expect(lastContext('orchard.authRequired')).toBe(true);
    expect(s.signInRequests()).toBe(1);
  });

  it('reportUnauthorized({tokenRejected:true}) deletes the session under compare-before-delete', async () => {
    const s = setup({ stored: session() });
    await s.manager.initialize();
    const moved = session({ accessToken: 'access-b', refreshToken: 'refresh-b' });
    s.listeners.length = 0;
    await s.otherWindow.write(SERVER_NORM, moved);
    await s.manager.reportUnauthorized({ tokenRejected: true });
    expect(await s.persisted()).toEqual(moved);
    expect(s.manager.getSession()).toEqual(moved);

    await s.manager.reportUnauthorized({ tokenRejected: true });
    expect(await s.persisted()).toBeUndefined();
    expect(s.manager.getSession()).toBeUndefined();
    expect(s.changes).toEqual([{ added: session() }, { removed: moved }]);
    expect(lastContext('orchard.signedIn')).toBe(false);
    expect(lastContext('orchard.authRequired')).toBe(true);
  });

  it('tokenRejected with a newer stored token adopts it and fires no prompt and leaves authRequired untouched', async () => {
    const s = setup({ stored: session() });
    await s.manager.initialize();
    const moved = session({ accessToken: 'access-b', refreshToken: 'refresh-b' });
    s.listeners.length = 0;
    await s.otherWindow.write(SERVER_NORM, moved);
    await s.manager.reportUnauthorized({ tokenRejected: true });
    expect(s.manager.getSession()).toEqual(moved);
    expect(await s.persisted()).toEqual(moved);
    expect(s.signInRequests()).toBe(0);
    expect(contextValues('orchard.authRequired')).toEqual([]);
    expect(s.changes).toEqual([{ added: session() }]);
    expect(await s.manager.getHeaders()).toEqual({ Authorization: 'Bearer access-b' });
  });

  it('a late 401 for a superseded access token is ignored', async () => {
    const s = setup({ stored: session({ expiresAt: NOW }) });
    await s.manager.initialize();
    s.fence.refresh.mockResolvedValueOnce(tokens('access-2', 'refresh-2'));
    expect(await s.manager.getHeaders()).toEqual({ Authorization: 'Bearer access-2' });
    const rotated = session({ accessToken: 'access-2', refreshToken: 'refresh-2', expiresAt: NOW + 3600 });

    await s.manager.reportUnauthorized({ tokenRejected: true, rejectedAccessToken: 'access-1' });
    expect(await s.persisted()).toEqual(rotated);
    expect(s.manager.getSession()).toEqual(rotated);
    expect(s.signInRequests()).toBe(0);
    expect(contextValues('orchard.authRequired')).toEqual([]);

    await s.manager.reportUnauthorized({ tokenRejected: true, rejectedAccessToken: 'access-2' });
    expect(await s.persisted()).toBeUndefined();
    expect(s.signInRequests()).toBe(1);
    expect(lastContext('orchard.authRequired')).toBe(true);
  });

  it('reportAuthorized clears authRequired', async () => {
    const s = setup({ stored: session() });
    await s.manager.initialize();
    await s.manager.reportUnauthorized({ tokenRejected: false });
    s.manager.reportAuthorized();
    expect(contextValues('orchard.authRequired')).toEqual([true, false]);
    s.manager.reportAuthorized();
    expect(contextValues('orchard.authRequired')).toEqual([true, false]);
  });

  it('setting a context key never throws when the command rejects', async () => {
    vi.mocked(vscode.commands.executeCommand).mockRejectedValue(new Error('boom'));
    const s = setup({ stored: session() });
    await s.manager.initialize();
    await s.manager.reportUnauthorized({ tokenRejected: false });
    await flush();
    expect(s.signInRequests()).toBe(1);
  });
});

describe('signOut', () => {
  it('deletes, fires removed and onDidChangeAuthentication, suppresses the sign-in prompt, does not set authRequired', async () => {
    const s = setup({ stored: session() });
    await s.manager.initialize();
    await s.manager.signOut();
    expect(await s.persisted()).toBeUndefined();
    expect(s.manager.getSession()).toBeUndefined();
    await flush();
    expect(s.changes).toEqual([{ added: session() }, { removed: session() }]);
    expect(s.authChanges()).toBe(2);
    expect(lastContext('orchard.signedIn')).toBe(false);
    expect(contextValues('orchard.authRequired')).toEqual([]);

    await s.manager.reportUnauthorized({ tokenRejected: false });
    expect(s.signInRequests()).toBe(0);
    expect(contextValues('orchard.authRequired')).toEqual([true]);
  });
});
