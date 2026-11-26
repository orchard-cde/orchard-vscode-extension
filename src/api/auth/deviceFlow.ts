import type * as vscode from 'vscode';
import {
  DeviceAuthorization,
  FenceClient,
  FenceEndpoints,
  FenceError,
  FenceTransportError,
  TokenResponse,
} from './fenceClient';
import * as logger from '../../util/logger';

const MIN_POLL_SECONDS = 5;
const SLOW_DOWN_SECONDS = 5;
const MAX_POLL_BACKOFF_SECONDS = 60;
const MAX_SIGN_IN_SECONDS = 600;

export interface PollOptions {
  /** Extra cancellation condition checked alongside the token. */
  isCancelled?: () => boolean;
}

function cancellableDelay(ms: number, token: vscode.CancellationToken): Promise<void> {
  return new Promise((resolve) => {
    if (token.isCancellationRequested) {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      subscription.dispose();
      resolve();
    };
    const timer = setTimeout(done, ms);
    const subscription = token.onCancellationRequested(done);
  });
}

/** Rejects with a user-facing Error on cancellation, timeout, denial, or a terminal Fence error. */
export async function pollForToken(
  fence: FenceClient,
  endpoints: FenceEndpoints,
  auth: DeviceAuthorization,
  token: vscode.CancellationToken,
  opts: PollOptions = {},
): Promise<TokenResponse> {
  const deadline = Date.now() + Math.min(auth.expiresIn, MAX_SIGN_IN_SECONDS) * 1000;
  let interval = Math.max(auth.interval, MIN_POLL_SECONDS);
  const cancelled = () => token.isCancellationRequested || (opts.isCancelled?.() ?? false);
  for (;;) {
    await cancellableDelay(Math.min(interval * 1000, Math.max(0, deadline - Date.now())), token);
    if (cancelled()) throw new Error('Sign-in cancelled');
    if (Date.now() >= deadline) throw new Error('Sign-in timed out. Run Orchard: Sign In again.');
    let response: TokenResponse;
    try {
      response = await fence.pollDeviceToken(endpoints, auth.deviceCode);
    } catch (err) {
      if (err instanceof FenceTransportError) {
        interval = Math.min(interval * 2, MAX_POLL_BACKOFF_SECONDS);
        logger.warn(`Sign-in poll failed, retrying in ${interval} s: ${err.message}`);
        continue;
      }
      if (!(err instanceof FenceError)) {
        throw new Error(`Sign-in failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      switch (err.code) {
        case 'authorization_pending':
          continue;
        case 'slow_down':
          interval += SLOW_DOWN_SECONDS;
          continue;
        case 'expired_token':
          throw new Error('The sign-in code expired. Run Orchard: Sign In again.');
        case 'access_denied':
          throw new Error('Sign-in was denied.');
        default:
          throw new Error(`Sign-in failed: ${err.message}`);
      }
    }
    if (cancelled()) throw new Error('Sign-in cancelled');
    return response;
  }
}
