import { afterEach, describe, expect, it, vi } from 'vitest';

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

import { SseClient } from '../sseClient';
import type { AuthProvider } from '../auth/authProvider';
import type { GroveStateChangedEvent } from '../types';

describe('SseClient with the real eventsource package', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('constructs the EventSource and emits a parsed grove-state-changed event', async () => {
    const payload = { groveId: 'g1', previousState: 'PLANTING', newState: 'GROWING' };
    const fetchMock = vi.fn(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              `event: grove-state-changed\ndata: ${JSON.stringify(payload)}\n\n`,
            ),
          );
        },
      });
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const auth = {
      getHeaders: vi.fn().mockResolvedValue({ Authorization: 'Bearer tok' }),
    } as unknown as AuthProvider;
    const client = new SseClient('http://trellis.test', auth);
    const received = new Promise<GroveStateChangedEvent>((resolve) =>
      client.onGroveStateChanged(resolve),
    );

    try {
      client.connect('g1');
      expect(await received).toEqual(payload);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string | URL, RequestInit];
      expect(String(url)).toBe('http://trellis.test/api/groves/g1/events');
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok');
    } finally {
      client.dispose();
    }
  });
});
