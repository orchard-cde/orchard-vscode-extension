import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  FenceClient,
  FenceError,
  FenceTransportError,
  FENCE_CLIENT_ID,
  type FenceEndpoints,
} from '../fenceClient';

const endpoints: FenceEndpoints = {
  deviceAuthorizationEndpoint: 'https://fence.example.com/oauth2/device_authorization',
  tokenEndpoint: 'https://fence.example.com/oauth2/token',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stub(response: Response | (() => Response)) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    typeof response === 'function' ? response() : response,
  );
}

function asFetch(fn: ReturnType<typeof stub>): typeof fetch {
  return fn as unknown as typeof fetch;
}

function headerOf(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers).get(name);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('FenceClient.discover', () => {
  it('reads both endpoints from the OIDC document', async () => {
    const fetchMock = stub(
      json({
        device_authorization_endpoint: endpoints.deviceAuthorizationEndpoint,
        token_endpoint: endpoints.tokenEndpoint,
      }),
    );
    const client = new FenceClient(asFetch(fetchMock));

    const result = await client.discover('https://fence.example.com/');

    expect(result).toEqual(endpoints);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'https://fence.example.com/.well-known/openid-configuration',
    );
    expect(fetchMock.mock.calls[0][1]?.method ?? 'GET').toBe('GET');
  });

  it('discover throws FenceError("other") when device_authorization_endpoint is absent', async () => {
    const client = new FenceClient(
      asFetch(stub(json({ token_endpoint: endpoints.tokenEndpoint }))),
    );
    await expect(client.discover('https://fence.example.com')).rejects.toMatchObject({
      name: 'FenceError',
      code: 'other',
    });
  });
});

describe('FenceClient.requestDeviceAuthorization', () => {
  it('posts form body client_id=trowel-cli and nothing else', async () => {
    const fetchMock = stub(
      json({
        device_code: 'dev123',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://fence.example.com/activate',
        verification_uri_complete: 'https://fence.example.com/activate?user_code=ABCD-EFGH',
        expires_in: 300,
        interval: 7,
      }),
    );
    const client = new FenceClient(asFetch(fetchMock));

    const result = await client.requestDeviceAuthorization(endpoints);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(endpoints.deviceAuthorizationEndpoint);
    expect(init?.method).toBe('POST');
    expect(headerOf(init, 'Content-Type')).toBe('application/x-www-form-urlencoded');
    expect(FENCE_CLIENT_ID).toBe('trowel-cli');
    expect(init?.body?.toString()).toBe('client_id=trowel-cli');
    expect(result).toEqual({
      deviceCode: 'dev123',
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://fence.example.com/activate',
      verificationUriComplete: 'https://fence.example.com/activate?user_code=ABCD-EFGH',
      expiresIn: 300,
      interval: 7,
    });
  });

  it('defaults interval to 5 and leaves verificationUriComplete undefined when absent', async () => {
    const client = new FenceClient(
      asFetch(
        stub(
          json({
            device_code: 'd',
            user_code: 'u',
            verification_uri: 'https://fence.example.com/activate',
            expires_in: 600,
          }),
        ),
      ),
    );
    const result = await client.requestDeviceAuthorization(endpoints);
    expect(result.interval).toBe(5);
    expect(result.verificationUriComplete).toBeUndefined();
  });
});

describe('FenceClient.pollDeviceToken', () => {
  it('posts grant_type=urn:ietf:params:oauth:grant-type:device_code, device_code, client_id', async () => {
    const fetchMock = stub(
      json({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, token_type: 'Bearer' }),
    );
    const client = new FenceClient(asFetch(fetchMock));

    const result = await client.pollDeviceToken(endpoints, 'dev123');

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(endpoints.tokenEndpoint);
    expect(init?.method).toBe('POST');
    expect(headerOf(init, 'Content-Type')).toBe('application/x-www-form-urlencoded');
    const body = new URLSearchParams(init?.body?.toString());
    expect(Object.fromEntries(body)).toEqual({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: 'dev123',
      client_id: 'trowel-cli',
    });
    expect(result).toEqual({ accessToken: 'at', refreshToken: 'rt', expiresIn: 3600 });
  });

  it.each(['authorization_pending', 'slow_down', 'expired_token', 'access_denied', 'invalid_grant'])(
    'pollDeviceToken maps error %s to FenceError.code and a message naming the code',
    async (code) => {
      const client = new FenceClient(asFetch(stub(json({ error: code }, 400))));
      const err = await client.pollDeviceToken(endpoints, 'd').catch((e) => e);
      expect(err).toBeInstanceOf(FenceError);
      expect(err.code).toBe(code);
      expect(err.message).toContain(code);
    },
  );

  it('uses error_description as the message when present', async () => {
    const client = new FenceClient(
      asFetch(stub(json({ error: 'access_denied', error_description: 'User said no' }, 400))),
    );
    const err = await client.pollDeviceToken(endpoints, 'd').catch((e) => e);
    expect(err).toBeInstanceOf(FenceError);
    expect(err.code).toBe('access_denied');
    expect(err.message).toBe('User said no');
  });

  it('pollDeviceToken maps an unknown error code to "other"', async () => {
    const client = new FenceClient(asFetch(stub(json({ error: 'server_exploded' }, 400))));
    const err = await client.pollDeviceToken(endpoints, 'd').catch((e) => e);
    expect(err).toBeInstanceOf(FenceError);
    expect(err.code).toBe('other');
    expect(err.message).toBe('fence error: other (server_exploded)');
  });

  it('a Spring-style error body on a 500 becomes FenceTransportError carrying the status', async () => {
    const client = new FenceClient(
      asFetch(stub(() => json({ error: 'Internal Server Error', status: 500 }, 500))),
    );
    const err = await client.refresh(endpoints, 'rt').catch((e) => e);
    expect(err).toBeInstanceOf(FenceTransportError);
    expect(err.status).toBe(500);
  });

  it('a known OAuth error code is a FenceError even on an unexpected status', async () => {
    const client = new FenceClient(asFetch(stub(() => json({ error: 'invalid_grant' }, 403))));
    const err = await client.refresh(endpoints, 'rt').catch((e) => e);
    expect(err).toBeInstanceOf(FenceError);
    expect(err.code).toBe('invalid_grant');
  });

  it('leaves refreshToken undefined when the response has none', async () => {
    const client = new FenceClient(asFetch(stub(json({ access_token: 'at', expires_in: 60 }))));
    const result = await client.pollDeviceToken(endpoints, 'd');
    expect(result.accessToken).toBe('at');
    expect(result.refreshToken).toBeUndefined();
    expect(result.expiresIn).toBe(60);
  });
});

describe('FenceClient.refresh', () => {
  it('posts grant_type=refresh_token, refresh_token, client_id', async () => {
    const fetchMock = stub(json({ access_token: 'at2', refresh_token: 'rt2', expires_in: 1800 }));
    const client = new FenceClient(asFetch(fetchMock));

    const result = await client.refresh(endpoints, 'rt1');

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(endpoints.tokenEndpoint);
    expect(init?.method).toBe('POST');
    expect(headerOf(init, 'Content-Type')).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(init?.body?.toString()))).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'rt1',
      client_id: 'trowel-cli',
    });
    expect(result).toEqual({ accessToken: 'at2', refreshToken: 'rt2', expiresIn: 1800 });
  });

  it('maps invalid_grant on refresh', async () => {
    const client = new FenceClient(asFetch(stub(json({ error: 'invalid_grant' }, 400))));
    await expect(client.refresh(endpoints, 'rt')).rejects.toMatchObject({ code: 'invalid_grant' });
  });
});

describe('token response validation', () => {
  it.each([
    ['missing', { access_token: 'at' }],
    ['zero', { access_token: 'at', expires_in: 0 }],
    ['negative', { access_token: 'at', expires_in: -5 }],
    ['non-numeric', { access_token: 'at', expires_in: 'soon' }],
  ])('token responses with %s expires_in throw FenceError("other")', async (_label, body) => {
    const client = new FenceClient(asFetch(stub(() => json(body))));
    for (const call of [
      () => client.pollDeviceToken(endpoints, 'd'),
      () => client.refresh(endpoints, 'rt'),
    ]) {
      const err = await call().catch((e) => e);
      expect(err).toBeInstanceOf(FenceError);
      expect(err.code).toBe('other');
    }
  });
});

describe('transport failures', () => {
  it('fetch rejection becomes FenceTransportError carrying the cause', async () => {
    const cause = new TypeError('network down');
    const client = new FenceClient(
      vi.fn(async () => {
        throw cause;
      }) as unknown as typeof fetch,
    );
    const err = await client.refresh(endpoints, 'rt').catch((e) => e);
    expect(err).toBeInstanceOf(FenceTransportError);
    expect((err as Error & { cause?: unknown }).cause).toBe(cause);
  });

  it('non-JSON 5xx becomes FenceTransportError', async () => {
    const client = new FenceClient(
      asFetch(stub(() => new Response('<html>bad gateway</html>', { status: 502 }))),
    );
    await expect(client.pollDeviceToken(endpoints, 'd')).rejects.toBeInstanceOf(FenceTransportError);
  });

  it('JSON error status without an error field becomes FenceTransportError', async () => {
    const client = new FenceClient(asFetch(stub(() => json({ message: 'oops' }, 500))));
    await expect(client.refresh(endpoints, 'rt')).rejects.toBeInstanceOf(FenceTransportError);
  });

  it('non-JSON 2xx becomes FenceTransportError', async () => {
    const client = new FenceClient(asFetch(stub(() => new Response('ok', { status: 200 }))));
    await expect(client.discover('https://fence.example.com')).rejects.toBeInstanceOf(
      FenceTransportError,
    );
  });

  it('aborts after timeoutMs and surfaces FenceTransportError', async () => {
    vi.useFakeTimers();
    const hanging = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    const client = new FenceClient(hanging as unknown as typeof fetch, 1000);

    const pending = client.refresh(endpoints, 'rt').catch((e) => e);
    await vi.advanceTimersByTimeAsync(1000);
    const err = await pending;

    expect(err).toBeInstanceOf(FenceTransportError);
    expect(err.message).toBe('fence request timed out after 1000 ms');
  });
});
