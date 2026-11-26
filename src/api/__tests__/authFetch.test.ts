import { describe, it, expect, vi } from 'vitest';
import { createAuthFetch } from '../auth/authFetch';
import type { AuthProvider } from '../auth/authProvider';

function makeAuth(headers: Record<string, string> = { Authorization: 'Bearer tok' }): AuthProvider {
  return { getHeaders: vi.fn().mockResolvedValue(headers) } as unknown as AuthProvider;
}

describe('createAuthFetch', () => {
  const forms: Array<[string, HeadersInit | undefined]> = [
    ['Headers instance', new Headers({ Accept: 'text/event-stream' })],
    ['array of pairs', [['Accept', 'text/event-stream']]],
    ['plain record', { Accept: 'text/event-stream' }],
    ['undefined', undefined],
  ];

  it.each(forms)('merges Authorization into init.headers given as %s', async (_name, initHeaders) => {
    const base = vi.fn().mockResolvedValue(new Response('ok'));
    const authFetch = createAuthFetch(makeAuth(), base as unknown as typeof fetch);

    await authFetch('http://x/events', { headers: initHeaders });

    const sent = base.mock.calls[0][1].headers as Headers;
    expect(sent).toBeInstanceOf(Headers);
    expect(sent.get('Authorization')).toBe('Bearer tok');
    if (initHeaders !== undefined) {
      expect(sent.get('Accept')).toBe('text/event-stream');
    }
  });

  it('passes through all other init fields and the input', async () => {
    const base = vi.fn().mockResolvedValue(new Response('ok'));
    const authFetch = createAuthFetch(makeAuth(), base as unknown as typeof fetch);
    const signal = new AbortController().signal;

    await authFetch('http://x/events', { method: 'POST', body: 'b', signal, headers: { A: '1' } });

    const [input, init] = base.mock.calls[0];
    expect(input).toBe('http://x/events');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('b');
    expect(init.signal).toBe(signal);
  });

  it('overrides an existing Authorization header', async () => {
    const base = vi.fn().mockResolvedValue(new Response('ok'));
    const authFetch = createAuthFetch(makeAuth(), base as unknown as typeof fetch);

    await authFetch('http://x', { headers: { Authorization: 'Bearer old' } });

    expect((base.mock.calls[0][1].headers as Headers).get('Authorization')).toBe('Bearer tok');
  });

  it('resolves the global fetch lazily when no base is given', async () => {
    const stub = vi.fn().mockResolvedValue(new Response('ok'));
    const authFetch = createAuthFetch(makeAuth());
    vi.stubGlobal('fetch', stub);
    try {
      await authFetch('http://x');
      expect(stub).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
