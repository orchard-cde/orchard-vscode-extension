import { describe, it, expect, vi } from 'vitest';
import {
  SessionStore,
  accountFromAccessToken,
  normalizeServerUrl,
  sessionKey,
  type StoredSession,
} from '../sessionStore';
import { fakeSecrets, jwt } from '../../../__tests__/helpers';

const session: StoredSession = {
  accessToken: 'a',
  refreshToken: 'r',
  expiresAt: 1234,
  issuer: 'https://fence.example.com',
  account: { id: 'u1', label: 'user@example.com' },
};

describe('url helpers', () => {
  it('normalizeServerUrl trims and strips trailing slashes', () => {
    expect(normalizeServerUrl(' https://x/ ')).toBe('https://x');
    expect(normalizeServerUrl('https://x///')).toBe('https://x');
  });

  it('sessionKey prefixes orchard.session:', () => {
    expect(sessionKey('https://x/')).toBe('orchard.session:https://x');
  });
});

describe('SessionStore', () => {
  it('round-trips a session through write/read', async () => {
    const { secrets } = fakeSecrets();
    const store = new SessionStore(secrets);
    await store.write('https://x/', session);
    expect(await store.read('https://x')).toEqual(session);
  });

  it('read returns undefined for absent, corrupt, or incomplete values', async () => {
    const { secrets, data } = fakeSecrets();
    const store = new SessionStore(secrets);
    expect(await store.read('https://x')).toBeUndefined();
    data.set(sessionKey('https://x'), '{not json');
    expect(await store.read('https://x')).toBeUndefined();
    data.set(sessionKey('https://x'), JSON.stringify({ accessToken: 'a' }));
    expect(await store.read('https://x')).toBeUndefined();
  });

  it('delete removes only this server key', async () => {
    const { secrets, data } = fakeSecrets();
    const store = new SessionStore(secrets);
    await store.write('https://x', session);
    await store.write('https://y', session);
    await store.delete('https://x/');
    expect(data.has(sessionKey('https://x'))).toBe(false);
    expect(data.has(sessionKey('https://y'))).toBe(true);
  });

  it('onDidChange fires only for this server key', async () => {
    const { secrets } = fakeSecrets();
    const store = new SessionStore(secrets);
    const listener = vi.fn();
    const sub = store.onDidChange('https://x', listener);
    await store.write('https://y', session);
    expect(listener).not.toHaveBeenCalled();
    await store.write('https://x/', session);
    expect(listener).toHaveBeenCalledTimes(1);
    sub.dispose();
    await store.delete('https://x');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('accountFromAccessToken', () => {
  it('uses sub and email', () => {
    expect(accountFromAccessToken(jwt({ sub: 'u1', email: 'a@b.c', name: 'N' }))).toEqual({
      id: 'u1',
      label: 'a@b.c',
    });
  });

  it('falls back to name then sub when email is absent', () => {
    expect(accountFromAccessToken(jwt({ sub: 'u1', name: 'Name' })).label).toBe('Name');
    expect(accountFromAccessToken(jwt({ sub: 'u1' })).label).toBe('u1');
  });

  it('throws on a non-JWT string', () => {
    expect(() => accountFromAccessToken('not-a-jwt')).toThrow(/^invalid access token/);
  });

  it('throws when sub is missing or the payload is not JSON', () => {
    expect(() => accountFromAccessToken(jwt({ email: 'a@b.c' }))).toThrow(/^invalid access token/);
    expect(() => accountFromAccessToken('a.!!!.c')).toThrow(/^invalid access token/);
  });
});
