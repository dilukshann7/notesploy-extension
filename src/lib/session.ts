import { browser } from 'wxt/browser';

// Token storage lives in its own module so api.ts and auth.ts can both use it without a cycle.
const TOKEN_KEY = 'notesploy.sessionToken';
const EXPIRED_KEY = 'notesploy.sessionExpired';

export async function getSessionToken(): Promise<string | undefined> {
  const stored = await browser.storage.local.get(TOKEN_KEY);
  const token = stored[TOKEN_KEY];
  return typeof token === 'string' && token.length > 0 ? token : undefined;
}

export async function storeSessionToken(token: string): Promise<void> {
  await browser.storage.local.set({ [TOKEN_KEY]: token, [EXPIRED_KEY]: false });
}

/** Called on a 401: drop the token and remember that the user must reconnect. */
export async function expireSession(): Promise<void> {
  await browser.storage.local.remove(TOKEN_KEY);
  await browser.storage.local.set({ [EXPIRED_KEY]: true });
}

export async function clearSessionToken(): Promise<void> {
  await browser.storage.local.remove([TOKEN_KEY, EXPIRED_KEY]);
}

export async function isSessionExpired(): Promise<boolean> {
  const stored = await browser.storage.local.get(EXPIRED_KEY);
  return stored[EXPIRED_KEY] === true;
}
