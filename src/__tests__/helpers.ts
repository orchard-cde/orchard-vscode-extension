import { vi } from 'vitest';
import type * as vscode from 'vscode';

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Unsigned JWT carrying `payload`; the header and signature are placeholders. */
export function jwt(payload: unknown): string {
  const segment = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${segment({ alg: 'none' })}.${segment(payload)}.sig`;
}

export const flush = () => new Promise((r) => setTimeout(r, 0));

/** In-memory SecretStorage whose writes and deletes notify registered listeners. */
export function fakeSecrets(initial: Record<string, string> = {}) {
  const data = new Map<string, string>(Object.entries(initial));
  const listeners: Array<(e: { key: string }) => void> = [];
  const notify = (key: string) => listeners.forEach((l) => l({ key }));
  const secrets = {
    get: vi.fn(async (key: string) => data.get(key)),
    store: vi.fn(async (key: string, value: string) => {
      data.set(key, value);
      notify(key);
    }),
    delete: vi.fn(async (key: string) => {
      data.delete(key);
      notify(key);
    }),
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
  return { data, secrets: secrets as unknown as vscode.SecretStorage, listeners };
}
