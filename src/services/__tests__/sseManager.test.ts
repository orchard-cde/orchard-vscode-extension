import { describe, it, expect, vi, beforeEach } from 'vitest';

interface FakeSource {
  url: string;
  init: { fetch: typeof fetch };
  close: ReturnType<typeof vi.fn>;
}

const created = vi.hoisted(() => [] as FakeSource[]);

vi.mock('vscode', () => {
  class EventEmitter<T> {
    private listeners = new Set<(e: T) => void>();
    event = (l: (e: T) => void) => {
      this.listeners.add(l);
      return { dispose: () => this.listeners.delete(l) };
    };
    fire(e: T) {
      for (const l of Array.from(this.listeners)) l(e);
    }
    dispose() {
      this.listeners.clear();
    }
  }
  return {
    EventEmitter,
    Disposable: class {},
    window: { createOutputChannel: () => ({ appendLine: vi.fn(), show: vi.fn(), dispose: vi.fn() }) },
  };
});

vi.mock('eventsource', () => ({
  EventSource: class FakeEventSource {
    close = vi.fn();
    addEventListener = vi.fn();
    onerror: (() => void) | null = null;
    onopen: (() => void) | null = null;
    constructor(public url: string, public init: { fetch: typeof fetch }) {
      created.push(this);
    }
  },
}));

import * as vscode from 'vscode';
import * as logger from '../../util/logger';
import { SseManager } from '../sseManager';
import type { AuthProvider } from '../../api/auth/authProvider';

function makeAuth() {
  const emitter = new vscode.EventEmitter<void>();
  const auth = {
    getHeaders: vi.fn().mockResolvedValue({ Authorization: 'Bearer tok' }),
    isAuthenticated: vi.fn().mockResolvedValue(true),
    onDidChangeAuthentication: emitter.event,
  } as unknown as AuthProvider;
  return { auth, emitter };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('SseManager', () => {
  beforeEach(() => {
    created.length = 0;
  });

  it('constructs EventSource with a fetch option', async () => {
    const { auth } = makeAuth();
    const manager = new SseManager('http://trellis', auth);
    manager.subscribe('g1');

    expect(created).toHaveLength(1);
    expect(created[0].url).toBe('http://trellis/api/groves/g1/events');
    expect(typeof created[0].init.fetch).toBe('function');

    const base = vi.fn().mockResolvedValue(new Response('ok'));
    vi.stubGlobal('fetch', base);
    try {
      await created[0].init.fetch('http://trellis/api/groves/g1/events');
      expect((base.mock.calls[0][1].headers as Headers).get('Authorization')).toBe('Bearer tok');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('on onDidChangeAuthentication with isAuthenticated() true, every open client reconnects', async () => {
    const { auth, emitter } = makeAuth();
    const manager = new SseManager('http://trellis', auth);
    manager.subscribe('g1');
    manager.subscribe('g2');
    const first = [...created];

    emitter.fire();
    await flush();

    expect(first.every((es) => es.close.mock.calls.length === 1)).toBe(true);
    expect(created).toHaveLength(4);
    expect(created.slice(2).map((es) => es.url).sort()).toEqual([
      'http://trellis/api/groves/g1/events',
      'http://trellis/api/groves/g2/events',
    ]);
  });

  it('on onDidChangeAuthentication with isAuthenticated() false, unsubscribeAll() runs and no client reconnects', async () => {
    const { auth, emitter } = makeAuth();
    (auth.isAuthenticated as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const manager = new SseManager('http://trellis', auth);
    manager.subscribe('g1');
    manager.subscribe('g2');
    const spy = vi.spyOn(manager, 'unsubscribeAll');

    emitter.fire();
    await flush();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(2);
    expect(created.every((es) => es.close.mock.calls.length === 1)).toBe(true);

    emitter.fire();
    await flush();
    expect(created).toHaveLength(2);
  });

  it('unsubscribed groves are not reconnected', async () => {
    const { auth, emitter } = makeAuth();
    const manager = new SseManager('http://trellis', auth);
    manager.subscribe('g1');
    manager.subscribe('g2');
    manager.unsubscribe('g1');

    emitter.fire();
    await flush();

    expect(created).toHaveLength(3);
    expect(created[2].url).toBe('http://trellis/api/groves/g2/events');
  });

  it('a rejecting isAuthenticated() is logged and leaves clients untouched', async () => {
    const { auth, emitter } = makeAuth();
    (auth.isAuthenticated as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    const warn = vi.spyOn(logger, 'warn');
    const manager = new SseManager('http://trellis', auth);
    manager.subscribe('g1');

    emitter.fire();
    await flush();

    expect(created).toHaveLength(1);
    expect(created[0].close).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('auth change handling failed: Error: boom'));
    warn.mockRestore();
  });

  it('dispose() drops the auth subscription', async () => {
    const { auth, emitter } = makeAuth();
    const manager = new SseManager('http://trellis', auth);
    manager.subscribe('g1');
    manager.dispose();
    created.length = 0;

    emitter.fire();
    await flush();

    expect(auth.isAuthenticated).not.toHaveBeenCalled();
    expect(created).toHaveLength(0);
  });
});
