import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthMode, AuthProvider } from '../auth/authProvider';
import { TrellisClient } from '../trellisClient';
import { TrellisApiError } from '../types';

const BASE = 'http://trellis.test';

function makeAuth(mode: AuthMode, tokens: Array<string | undefined>): AuthProvider {
  const getHeaders = vi.fn();
  for (const token of tokens) {
    getHeaders.mockResolvedValueOnce(token ? { Authorization: `Bearer ${token}` } : {});
  }
  return {
    getHeaders,
    isAuthenticated: vi.fn(),
    getMode: vi.fn(() => mode),
    invalidate: vi.fn(),
    reportUnauthorized: vi.fn(async () => {}),
    reportAuthorized: vi.fn(),
    onDidChangeAuthentication: vi.fn(),
  } as unknown as AuthProvider;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function unauthorized(): Response {
  return new Response(JSON.stringify({ message: 'nope' }), { status: 401 });
}

describe('TrellisClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends Authorization from getHeaders', async () => {
    const auth = makeAuth('enabled', ['tok1']);
    fetchMock.mockResolvedValueOnce(json([]));
    await new TrellisClient(BASE, auth).listGroves();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/api/groves`);
    expect(init.headers.Authorization).toBe('Bearer tok1');
  });

  it('401 with bearer → invalidate, getHeaders again, retry once', async () => {
    const auth = makeAuth('enabled', ['old', 'new']);
    fetchMock.mockResolvedValueOnce(unauthorized()).mockResolvedValueOnce(json([{ id: 'g' }]));
    const result = await new TrellisClient(BASE, auth).listGroves();
    expect(result).toEqual([{ id: 'g' }]);
    expect(auth.invalidate).toHaveBeenCalledTimes(1);
    expect(auth.getHeaders).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer old');
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer new');
    expect(auth.reportUnauthorized).not.toHaveBeenCalled();
    expect(auth.reportAuthorized).toHaveBeenCalledTimes(1);
  });

  it('retry with the same bearer after a failed refresh reports tokenRejected:false', async () => {
    const auth = makeAuth('enabled', ['same', 'same']);
    fetchMock.mockResolvedValueOnce(unauthorized()).mockResolvedValueOnce(unauthorized());
    const err = await new TrellisClient(BASE, auth).listGroves().catch((e) => e);
    expect(err).toBeInstanceOf(TrellisApiError);
    expect(err.statusCode).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(auth.reportUnauthorized).toHaveBeenCalledTimes(1);
    expect(auth.reportUnauthorized).toHaveBeenCalledWith({ tokenRejected: false });
  });

  it('second 401 with bearer on retry → reportUnauthorized({tokenRejected:true}) and throws TrellisApiError 401', async () => {
    const auth = makeAuth('enabled', ['old', 'new']);
    fetchMock.mockResolvedValueOnce(unauthorized()).mockResolvedValueOnce(unauthorized());
    const err = await new TrellisClient(BASE, auth).listGroves().catch((e) => e);
    expect(err).toBeInstanceOf(TrellisApiError);
    expect(err.statusCode).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(auth.reportUnauthorized).toHaveBeenCalledTimes(1);
    expect(auth.reportUnauthorized).toHaveBeenCalledWith({
      tokenRejected: true,
      rejectedAccessToken: 'new',
    });
    expect(auth.reportAuthorized).not.toHaveBeenCalled();
  });

  it('second 401 without bearer on retry → reportUnauthorized({tokenRejected:false})', async () => {
    const auth = makeAuth('enabled', ['old', undefined]);
    fetchMock.mockResolvedValueOnce(unauthorized()).mockResolvedValueOnce(unauthorized());
    await expect(new TrellisClient(BASE, auth).listGroves()).rejects.toBeInstanceOf(TrellisApiError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(auth.reportUnauthorized).toHaveBeenCalledTimes(1);
    expect(auth.reportUnauthorized).toHaveBeenCalledWith({ tokenRejected: false });
  });

  it('401 without bearer in enabled mode → reportUnauthorized({tokenRejected:false}), no retry', async () => {
    const auth = makeAuth('enabled', [undefined]);
    fetchMock.mockResolvedValueOnce(unauthorized());
    const err = await new TrellisClient(BASE, auth).listGroves().catch((e) => e);
    expect(err).toBeInstanceOf(TrellisApiError);
    expect(err.statusCode).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(auth.invalidate).not.toHaveBeenCalled();
    expect(auth.reportUnauthorized).toHaveBeenCalledTimes(1);
    expect(auth.reportUnauthorized).toHaveBeenCalledWith({ tokenRejected: false });
  });

  it.each<AuthMode>(['disabled', 'unknown'])(
    '401 in %s mode → throws without reporting',
    async (mode) => {
      const auth = makeAuth(mode, [undefined]);
      fetchMock.mockResolvedValueOnce(unauthorized());
      const err = await new TrellisClient(BASE, auth).listGroves().catch((e) => e);
      expect(err).toBeInstanceOf(TrellisApiError);
      expect(err.statusCode).toBe(401);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(auth.reportUnauthorized).not.toHaveBeenCalled();
    },
  );

  it('2xx with bearer → reportAuthorized', async () => {
    const auth = makeAuth('enabled', ['tok']);
    fetchMock.mockResolvedValueOnce(json({ id: 'me' }));
    await new TrellisClient(BASE, auth).getMe();
    expect(auth.reportAuthorized).toHaveBeenCalledTimes(1);
    expect(auth.reportUnauthorized).not.toHaveBeenCalled();
  });

  it('2xx without bearer → no reportAuthorized', async () => {
    const auth = makeAuth('disabled', [undefined]);
    fetchMock.mockResolvedValueOnce(json({ id: 'me' }));
    await new TrellisClient(BASE, auth).getMe();
    expect(auth.reportAuthorized).not.toHaveBeenCalled();
  });

  it('POST is retried exactly once with the same body', async () => {
    const auth = makeAuth('enabled', ['old', 'new']);
    fetchMock.mockResolvedValueOnce(unauthorized()).mockResolvedValueOnce(json({ id: 'g1' }));
    const request = { name: 'grove' } as never;
    await new TrellisClient(BASE, auth).createGrove(request);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [first, second] = fetchMock.mock.calls.map((c) => c[1]);
    expect(first.method).toBe('POST');
    expect(second.method).toBe('POST');
    expect(first.body).toBe(JSON.stringify(request));
    expect(second.body).toBe(first.body);
    expect(second.headers.Authorization).toBe('Bearer new');
  });

  it('204 still resolves to undefined', async () => {
    const auth = makeAuth('enabled', ['tok']);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(new TrellisClient(BASE, auth).deleteGrove('g1')).resolves.toBeUndefined();
  });

  it('getSshConfig follows the same path and returns text', async () => {
    const auth = makeAuth('enabled', ['old', 'new']);
    fetchMock
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(new Response('Host grove\n  HostName x', { status: 200 }));
    const text = await new TrellisClient(BASE, auth).getSshConfig('g1');
    expect(text).toBe('Host grove\n  HostName x');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(`${BASE}/api/groves/g1/ssh-config`);
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer new');
    expect(auth.invalidate).toHaveBeenCalledTimes(1);
    expect(auth.reportAuthorized).toHaveBeenCalledTimes(1);
  });
});
