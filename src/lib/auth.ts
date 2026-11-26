import { browser } from 'wxt/browser';
import { WEB_BASE } from './config';
import { apiRequest, exchangeCode } from './api';
import { createPkcePair } from './pkce';
import { clearSessionToken, getSessionToken, storeSessionToken } from './session';

export {
  clearSessionToken,
  getSessionToken,
  isSessionExpired,
  storeSessionToken,
} from './session';

export class ConnectError extends Error {
  readonly cancelled: boolean;

  constructor(cancelled: boolean, message: string) {
    super(message);
    this.name = 'ConnectError';
    this.cancelled = cancelled;
  }
}

/**
 * Runs the PKCE connect flow in a web auth window and stores the resulting session token.
 * Must run in the background (the popup closes when the auth window takes focus).
 */
export async function connect(): Promise<void> {
  const { verifier, challenge } = await createPkcePair();
  const redirectUri = browser.identity.getRedirectURL();
  const url = `${WEB_BASE}/extension/connect?challenge=${challenge}&redirect_uri=${encodeURIComponent(redirectUri)}`;

  let responseUrl: string | undefined;
  try {
    responseUrl = await browser.identity.launchWebAuthFlow({ url, interactive: true });
  } catch {
    // Closing the auth window rejects the promise.
    throw new ConnectError(true, 'Sign-in was cancelled.');
  }
  if (!responseUrl) throw new ConnectError(true, 'Sign-in was cancelled.');

  const params = new URL(responseUrl).searchParams;
  if (params.get('error') === 'cancelled') throw new ConnectError(true, 'Sign-in was cancelled.');
  const code = params.get('code');
  if (!code) throw new ConnectError(false, 'Sign-in did not finish. Try again.');

  const token = await exchangeCode(code, verifier);
  if (!token) throw new ConnectError(false, 'Sign-in did not finish. Try again.');
  await storeSessionToken(token);
}

export async function signOut(): Promise<void> {
  const token = await getSessionToken();
  try {
    // Older extension sessions share the browser's managed session.
    if (token?.startsWith('np1.')) await apiRequest('/api/auth/sign-out', { body: {} });
  } catch {
    // Forget the local credential even when the server cannot be reached.
  } finally {
    await clearSessionToken();
  }
}
