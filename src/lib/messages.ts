import { browser } from 'wxt/browser';
import { ApiError, getUsage, listRecentThreads, UNAUTHORIZED } from './api';
import { connect, signOut } from './auth';
import { getSessionToken, isSessionExpired } from './session';
import { getFallback, saveFallback, saveLink, saveVisibleText, type FallbackRecord, type SaveResult } from './actions';
import { isWebUrl } from './capture';
import type { ThreadListItem, UsageSummary } from './types';

/** Messages from the popup to the background. */
export type PopupMessage =
  | { type: 'state' }
  | { type: 'connect' }
  | { type: 'signOut' }
  | { type: 'savePage' }
  | { type: 'saveVisible' }
  | { type: 'saveFallback' };

export interface PopupState {
  connected: boolean;
  sessionExpired: boolean;
  usage: UsageSummary | null;
  recent: ThreadListItem[];
  fallback: FallbackRecord | null;
}

export interface ActionReply {
  ok: boolean;
  message?: string;
  code?: string;
  resetsAt?: string;
  state?: PopupState;
}

export async function readPopupState(): Promise<PopupState> {
  const fallback = await getFallback();
  const token = await getSessionToken();
  if (!token) {
    return {
      connected: false,
      sessionExpired: await isSessionExpired(),
      usage: null,
      recent: [],
      fallback,
    };
  }

  const [usage, recent] = await Promise.allSettled([getUsage(), listRecentThreads(5)]);
  const unauthorized = [usage, recent].some(
    (result) => result.status === 'rejected' && result.reason instanceof ApiError && result.reason.code === UNAUTHORIZED,
  );
  if (unauthorized) {
    return { connected: false, sessionExpired: true, usage: null, recent: [], fallback };
  }
  return {
    connected: true,
    sessionExpired: false,
    usage: usage.status === 'fulfilled' ? usage.value : null,
    recent: recent.status === 'fulfilled' ? recent.value.items : [],
    fallback,
  };
}

async function activeTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function fromSave(result: SaveResult, successMessage: string): ActionReply {
  if (result.ok) return { ok: true, message: successMessage };
  return { ok: false, code: result.code, message: result.message, resetsAt: result.resetsAt };
}

/** Routes one popup message. Always resolves with a reply, never throws. */
export async function handleMessage(message: PopupMessage): Promise<ActionReply> {
  try {
    switch (message.type) {
      case 'state':
        return { ok: true, state: await readPopupState() };

      case 'connect':
        await connect();
        return { ok: true, message: 'Connected to Notesploy.', state: await readPopupState() };

      case 'signOut':
        await signOut();
        return { ok: true, state: await readPopupState() };

      case 'savePage': {
        const tab = await activeTab();
        if (!tab || !isWebUrl(tab.url)) {
          return { ok: false, message: "This page can't be saved. Open a web page and try again." };
        }
        return fromSave(await saveLink(tab.url, tab.id), 'Saving. We will tell you when your notes are ready.');
      }

      case 'saveVisible': {
        const tab = await activeTab();
        if (tab?.id === undefined) return { ok: false, message: 'Open a web page and try again.' };
        return fromSave(await saveVisibleText(tab.id, tab.url), 'Saving what you see.');
      }

      case 'saveFallback': {
        const result = await saveFallback();
        if (!result) return { ok: false, message: 'Nothing to save right now.' };
        return fromSave(result, 'Saving what you see.');
      }
    }
  } catch (error) {
    if (error instanceof ApiError && error.code === UNAUTHORIZED) {
      return { ok: false, code: UNAUTHORIZED, message: 'Your session ended. Reconnect to continue.' };
    }
    const message = error instanceof Error && error.message ? error.message : 'Something went wrong. Try again.';
    return { ok: false, message };
  }
}
