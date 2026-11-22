import { browser } from 'wxt/browser';
import { ApiError, getThread, UNAUTHORIZED } from './api';
import type { ThreadDetail } from './types';

export const POLL_INTERVAL_MS = 3_000;
export const POLL_TIMEOUT_MS = 180_000;

export type PollOutcome =
  | { outcome: 'ready' | 'partial' | 'failed'; thread: ThreadDetail }
  | { outcome: 'timeout' }
  | { outcome: 'unauthorized' };

export interface PollOptions {
  intervalMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  fetchThread?: (threadId: string) => Promise<ThreadDetail>;
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Polls GET /api/threads/{id} until it reaches a settled status or the timeout passes.
 * Transient errors keep polling; 401 stops it.
 */
export async function waitForThread(threadId: string, options: PollOptions = {}): Promise<PollOutcome> {
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? POLL_TIMEOUT_MS;
  const sleep = options.sleep ?? delay;
  const now = options.now ?? Date.now;
  const fetchThread = options.fetchThread ?? getThread;
  const startedAt = now();

  for (;;) {
    try {
      const thread = await fetchThread(threadId);
      if (thread.status === 'ready' || thread.status === 'partial' || thread.status === 'failed') {
        return { outcome: thread.status, thread };
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === UNAUTHORIZED) return { outcome: 'unauthorized' };
    }
    if (now() - startedAt >= timeoutMs) return { outcome: 'timeout' };
    await sleep(intervalMs);
  }
}

/* Pending captures are stored so polling resumes after the service worker restarts. */

export interface PendingCapture {
  threadId: string;
  tabId?: number;
  sourceUrl?: string;
  kind: 'link' | 'highlight' | 'page' | 'image';
  startedAt: number;
}

const PENDING_KEY = 'notesploy.pending';

export async function listPending(): Promise<PendingCapture[]> {
  const stored = await browser.storage.local.get(PENDING_KEY);
  const value = stored[PENDING_KEY];
  return Array.isArray(value) ? (value as PendingCapture[]) : [];
}

async function writePending(entries: PendingCapture[]): Promise<void> {
  await browser.storage.local.set({ [PENDING_KEY]: entries });
}

export async function trackPending(entry: PendingCapture): Promise<void> {
  const others = (await listPending()).filter((item) => item.threadId !== entry.threadId);
  await writePending([...others, entry]);
}

export async function untrackPending(threadId: string): Promise<void> {
  await writePending((await listPending()).filter((item) => item.threadId !== threadId));
}
