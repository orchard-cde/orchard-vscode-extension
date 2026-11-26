import type * as vscode from 'vscode';

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  issuer: string;
  account: { id: string; label: string };
}

export function normalizeServerUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export function sessionKey(serverUrl: string): string {
  return `orchard.session:${normalizeServerUrl(serverUrl)}`;
}

function isStoredSession(value: unknown): value is StoredSession {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const account = v.account as Record<string, unknown> | null | undefined;
  return (
    typeof v.accessToken === 'string' &&
    typeof v.refreshToken === 'string' &&
    typeof v.expiresAt === 'number' &&
    typeof v.issuer === 'string' &&
    typeof account === 'object' &&
    account !== null &&
    typeof account.id === 'string' &&
    typeof account.label === 'string'
  );
}

export function accountFromAccessToken(token: string): { id: string; label: string } {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('invalid access token: not a JWT');
  }
  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object');
    payload = parsed as Record<string, unknown>;
  } catch {
    throw new Error('invalid access token: unreadable payload');
  }
  if (typeof payload.sub !== 'string' || payload.sub === '') {
    throw new Error('invalid access token: missing sub');
  }
  const label =
    typeof payload.email === 'string' && payload.email
      ? payload.email
      : typeof payload.name === 'string' && payload.name
        ? payload.name
        : payload.sub;
  return { id: payload.sub, label };
}

export class SessionStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async read(serverUrl: string): Promise<StoredSession | undefined> {
    const raw = await this.secrets.get(sessionKey(serverUrl));
    if (raw === undefined) return undefined;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isStoredSession(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  async write(serverUrl: string, session: StoredSession): Promise<void> {
    await this.secrets.store(sessionKey(serverUrl), JSON.stringify(session));
  }

  async delete(serverUrl: string): Promise<void> {
    await this.secrets.delete(sessionKey(serverUrl));
  }

  onDidChange(serverUrl: string, listener: () => void): vscode.Disposable {
    const key = sessionKey(serverUrl);
    return this.secrets.onDidChange((e) => {
      if (e.key === key) listener();
    });
  }
}
