import type { AuthProvider } from './authProvider';

export function createAuthFetch(auth: AuthProvider, base?: typeof fetch): typeof fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    for (const [key, value] of Object.entries(await auth.getHeaders())) {
      headers.set(key, value);
    }
    return (base ?? fetch)(input, { ...init, headers });
  };
}
