export const FENCE_CLIENT_ID = 'trowel-cli';

const DEVICE_CODE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const DEFAULT_INTERVAL_SECONDS = 5;
const DEFAULT_TIMEOUT_MS = 15_000;

export interface FenceEndpoints {
  deviceAuthorizationEndpoint: string;
  tokenEndpoint: string;
}

export interface DeviceAuthorization {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresIn: number;
  interval: number;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
}

export type FenceErrorCode =
  | 'authorization_pending'
  | 'slow_down'
  | 'expired_token'
  | 'access_denied'
  | 'invalid_grant'
  | 'other';

const KNOWN_ERROR_CODES: readonly FenceErrorCode[] = [
  'authorization_pending',
  'slow_down',
  'expired_token',
  'access_denied',
  'invalid_grant',
];

export class FenceError extends Error {
  readonly code: FenceErrorCode;

  constructor(code: FenceErrorCode, message?: string) {
    super(message ?? `fence error: ${code}`);
    this.name = 'FenceError';
    this.code = code;
  }
}

export class FenceTransportError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'FenceTransportError';
  }
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(body: JsonObject, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || value === '') {
    throw new FenceError('other', `fence response missing ${field}`);
  }
  return value;
}

function requirePositiveNumber(body: JsonObject, field: string): number {
  const value = body[field];
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new FenceError('other', `fence response has missing or invalid ${field}`);
  }
  return value;
}

function toTokenResponse(body: JsonObject): TokenResponse {
  return {
    accessToken: requireString(body, 'access_token'),
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : undefined,
    expiresIn: requirePositiveNumber(body, 'expires_in'),
  };
}

export class FenceClient {
  constructor(
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  async discover(issuer: string): Promise<FenceEndpoints> {
    const base = issuer.endsWith('/') ? issuer.slice(0, -1) : issuer;
    const body = await this.send(`${base}/.well-known/openid-configuration`, { method: 'GET' });
    return {
      deviceAuthorizationEndpoint: requireString(body, 'device_authorization_endpoint'),
      tokenEndpoint: requireString(body, 'token_endpoint'),
    };
  }

  async requestDeviceAuthorization(endpoints: FenceEndpoints): Promise<DeviceAuthorization> {
    const body = await this.postForm(endpoints.deviceAuthorizationEndpoint, {
      client_id: FENCE_CLIENT_ID,
    });
    return {
      deviceCode: requireString(body, 'device_code'),
      userCode: requireString(body, 'user_code'),
      verificationUri: requireString(body, 'verification_uri'),
      verificationUriComplete:
        typeof body.verification_uri_complete === 'string'
          ? body.verification_uri_complete
          : undefined,
      expiresIn: requirePositiveNumber(body, 'expires_in'),
      interval:
        typeof body.interval === 'number' && body.interval > 0
          ? body.interval
          : DEFAULT_INTERVAL_SECONDS,
    };
  }

  async pollDeviceToken(endpoints: FenceEndpoints, deviceCode: string): Promise<TokenResponse> {
    const body = await this.postForm(endpoints.tokenEndpoint, {
      grant_type: DEVICE_CODE_GRANT,
      device_code: deviceCode,
      client_id: FENCE_CLIENT_ID,
    });
    return toTokenResponse(body);
  }

  async refresh(endpoints: FenceEndpoints, refreshToken: string): Promise<TokenResponse> {
    const body = await this.postForm(endpoints.tokenEndpoint, {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: FENCE_CLIENT_ID,
    });
    return toTokenResponse(body);
  }

  private postForm(url: string, fields: Record<string, string>): Promise<JsonObject> {
    return this.send(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams(fields).toString(),
    });
  }

  private async send(url: string, init: RequestInit): Promise<JsonObject> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let status: number;
    let text: string;
    try {
      const response = await this.fetchImpl(url, { ...init, signal: controller.signal });
      status = response.status;
      text = await response.text();
    } catch (err) {
      if (controller.signal.aborted) {
        throw new FenceTransportError(
          `fence request timed out after ${this.timeoutMs} ms`,
          err,
        );
      }
      throw new FenceTransportError(
        `fence request failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    } finally {
      clearTimeout(timer);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new FenceTransportError(`fence returned a non-JSON response (HTTP ${status})`);
    }

    if (isObject(parsed) && typeof parsed.error === 'string') {
      const code = (KNOWN_ERROR_CODES as readonly string[]).includes(parsed.error)
        ? (parsed.error as FenceErrorCode)
        : 'other';
      const description =
        typeof parsed.error_description === 'string' && parsed.error_description !== ''
          ? parsed.error_description
          : undefined;
      throw new FenceError(code, description);
    }

    if (status < 200 || status >= 300) {
      throw new FenceTransportError(`fence returned HTTP ${status}`);
    }
    if (!isObject(parsed)) {
      throw new FenceTransportError('fence returned an unexpected JSON payload');
    }
    return parsed;
  }
}
