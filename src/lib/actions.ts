import { browser } from 'wxt/browser';
import {
  ApiError,
  cancelUpload,
  completeUpload,
  createCapture,
  createUpload,
  getUsage,
  transferUpload,
  USAGE_LIMIT_EXCEEDED,
} from './api';
import { PLAN_SETTINGS_URL, threadUrl } from './config';
import {
  assertImageSize,
  buildHighlightBody,
  buildLinkBody,
  buildPageBody,
  CaptureInputError,
  imageFilename,
  IMAGE_TYPE_ERROR,
  isWebUrl,
  sniffImageType,
} from './capture';
import { readVisiblePageFromTab, showToast } from './page';
import { listPending, POLL_TIMEOUT_MS, trackPending, untrackPending, waitForThread, type PendingCapture } from './status';
import type { CaptureAccepted, CaptureInput } from './types';
import { formatResetTime, LIMIT_MESSAGE, notify, setBadge } from './ui';

export type SaveResult =
  | { ok: true; threadId: string }
  | { ok: false; code: string; message: string; resetsAt?: string };

export interface FallbackRecord {
  threadId: string;
  tabId: number;
  url: string;
}

const RETRY_DELAYS_MS = [1_000, 2_500];
const FALLBACK_KEY = 'notesploy.fallback';
// Failures where the server could not read the page, so the visible text may still work.
const FALLBACK_CODES = new Set(['SOURCE_UNAVAILABLE', 'ADAPTER_UNAVAILABLE']);

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Retries only failures the API marks retryable (network errors, 5xx, 429). Reuses the same key. */
async function withRetries<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      const retryable = error instanceof ApiError && error.retryable;
      if (!retryable || attempt >= RETRY_DELAYS_MS.length) throw error;
      await delay(RETRY_DELAYS_MS[attempt]!);
    }
  }
}

function limitText(resetsAt: string | undefined): string {
  return `${LIMIT_MESSAGE} Resets ${formatResetTime(resetsAt)}.`;
}

async function reportFailure(tabId: number | undefined, error: unknown): Promise<SaveResult> {
  const code = error instanceof ApiError ? error.code : error instanceof CaptureInputError ? 'INPUT' : 'ERROR';
  const fallbackMessage = 'Something went wrong. Try again.';
  const message = error instanceof Error && error.message ? error.message : fallbackMessage;

  await setBadge(tabId, 'error');

  if (code === USAGE_LIMIT_EXCEEDED) {
    let resetsAt: string | undefined;
    try {
      resetsAt = (await getUsage()).resetsAt;
    } catch {
      resetsAt = undefined;
    }
    const text = limitText(resetsAt);
    await showToast(tabId, {
      state: 'error',
      message: text,
      linkLabel: 'Try Pro free for 7 days',
      href: PLAN_SETTINGS_URL,
    });
    return { ok: false, code, message: text, resetsAt };
  }

  await showToast(tabId, { state: 'error', message });
  return { ok: false, code, message };
}

/** Shared path for every capture: badge, toasts, one idempotency key, then background tracking. */
async function runSave(options: {
  tabId?: number;
  sourceUrl?: string;
  kind: PendingCapture['kind'];
  job: (idempotencyKey: string) => Promise<CaptureAccepted>;
}): Promise<SaveResult> {
  const idempotencyKey = crypto.randomUUID();
  await setBadge(options.tabId, 'saving');
  await showToast(options.tabId, { state: 'saving', message: 'Saving…' });

  let accepted: CaptureAccepted;
  try {
    accepted = await options.job(idempotencyKey);
  } catch (error) {
    return reportFailure(options.tabId, error);
  }

  await showToast(options.tabId, {
    state: 'saved',
    message: 'Saved ✓',
    linkLabel: 'Open notes',
    href: threadUrl(accepted.threadId),
  });
  void followCapture({
    threadId: accepted.threadId,
    tabId: options.tabId,
    sourceUrl: options.sourceUrl,
    kind: options.kind,
    startedAt: Date.now(),
  });
  return { ok: true, threadId: accepted.threadId };
}

function submitCapture(body: CaptureInput) {
  return (key: string) => withRetries(() => createCapture(body, key));
}

/** "Save page" and "Save link": the API reads the URL itself. */
export async function saveLink(sourceUrl: string | undefined, tabId?: number): Promise<SaveResult> {
  let body: CaptureInput;
  try {
    body = buildLinkBody(sourceUrl ?? '');
  } catch (error) {
    return reportFailure(tabId, error);
  }
  return runSave({ tabId, sourceUrl, kind: 'link', job: submitCapture(body) });
}

export async function saveHighlight(input: {
  text: string | undefined;
  sourceUrl: string | undefined;
  title?: string;
  tabId?: number;
}): Promise<SaveResult> {
  let body: CaptureInput;
  const sourceUrl = input.sourceUrl ?? '';
  try {
    if (!isWebUrl(sourceUrl)) throw new CaptureInputError("This page can't be saved. Open a web page and try again.");
    body = buildHighlightBody({ sourceUrl, text: input.text ?? '', title: input.title });
  } catch (error) {
    return reportFailure(input.tabId, error);
  }
  return runSave({ tabId: input.tabId, sourceUrl: input.sourceUrl, kind: 'highlight', job: submitCapture(body) });
}

/** "Save what I see": the visible text of the tab, read before the toast appears. */
export async function saveVisibleText(tabId: number, sourceUrl = ''): Promise<SaveResult> {
  let body: CaptureInput;
  try {
    if (!isWebUrl(sourceUrl)) throw new CaptureInputError("This page can't be saved. Open a web page and try again.");
    let page: Awaited<ReturnType<typeof readVisiblePageFromTab>>;
    try {
      page = await readVisiblePageFromTab(tabId);
    } catch {
      throw new CaptureInputError('Open the page and use Save what I see from the Notesploy popup.');
    }
    body = buildPageBody({ sourceUrl, text: page.text, title: page.title });
  } catch (error) {
    return reportFailure(tabId, error);
  }
  return runSave({ tabId, sourceUrl, kind: 'page', job: submitCapture(body) });
}

/** Image capture: fetch bytes in the worker, validate, create an upload, PUT the bytes, then complete. */
export async function saveImage(srcUrl: string | undefined, tabId?: number): Promise<SaveResult> {
  if (!srcUrl || !(isWebUrl(srcUrl) || srcUrl.startsWith('data:image/'))) {
    return reportFailure(tabId, new CaptureInputError("This image can't be read. Save the page instead."));
  }
  return runSave({
    tabId,
    kind: 'image',
    job: async (idempotencyKey) => {
      let response: Response;
      try {
        response = await fetch(srcUrl);
      } catch {
        throw new CaptureInputError("This image can't be downloaded from its site. Save the page instead.");
      }
      if (!response.ok) {
        throw new CaptureInputError("This image can't be downloaded from its site. Save the page instead.");
      }
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > 0) assertImageSize(declared);

      const buffer = await response.arrayBuffer();
      assertImageSize(buffer.byteLength);
      const type = sniffImageType(new Uint8Array(buffer));
      if (!type) throw new CaptureInputError(IMAGE_TYPE_ERROR);

      const upload = await withRetries(() =>
        createUpload({ kind: 'image', filename: imageFilename(srcUrl, type) }, idempotencyKey),
      );
      try {
        await transferUpload(upload.uploadUrl, new Blob([buffer]));
      } catch (error) {
        void cancelUpload(upload.uploadId).catch(() => undefined);
        throw error;
      }
      return completeUpload(upload.uploadId);
    },
  });
}

/* Fallback record: the last link capture that the site refused, offered for "Save what I see". */

export async function getFallback(): Promise<FallbackRecord | null> {
  const stored = await browser.storage.local.get(FALLBACK_KEY);
  const value = stored[FALLBACK_KEY] as FallbackRecord | undefined;
  return value && typeof value.threadId === 'string' ? value : null;
}

async function setFallback(record: FallbackRecord | null): Promise<void> {
  if (record) await browser.storage.local.set({ [FALLBACK_KEY]: record });
  else await browser.storage.local.remove(FALLBACK_KEY);
}

/** Runs "Save what I see" for the stored fallback tab. */
export async function saveFallback(): Promise<SaveResult | null> {
  const record = await getFallback();
  if (!record) return null;
  const result = await saveVisibleText(record.tabId, record.url);
  if (result.ok) await setFallback(null);
  return result;
}

/* Background tracking. */

/** Fire-and-forget: polls the thread and sends the result as a notification. Never throws. */
export async function followCapture(entry: PendingCapture): Promise<void> {
  try {
    await trackPending(entry);
    const remaining = POLL_TIMEOUT_MS - (Date.now() - entry.startedAt);
    const result = remaining > 0
      ? await waitForThread(entry.threadId, { timeoutMs: remaining })
      : ({ outcome: 'timeout' } as const);
    await untrackPending(entry.threadId);

    if (result.outcome === 'ready' || result.outcome === 'partial') {
      await setBadge(entry.tabId, 'saved');
      await notify(`thread:${entry.threadId}`, {
        title: 'Your notes are ready',
        message: result.thread.title || 'Open it in your Notesploy library.',
      });
    } else if (result.outcome === 'failed') {
      await setBadge(entry.tabId, 'error');
      const refused = FALLBACK_CODES.has(result.thread.failure?.code ?? '');
      if (entry.kind === 'link' && refused && entry.tabId !== undefined && entry.sourceUrl) {
        await setFallback({ threadId: entry.threadId, tabId: entry.tabId, url: entry.sourceUrl });
        await notify(`fallback:${entry.threadId}`, {
          title: "Notesploy couldn't read this page",
          message: 'Save the text you can see on the page instead.',
          buttons: ['Save what I see'],
        });
      } else {
        await notify(`thread:${entry.threadId}`, {
          title: "Couldn't save this",
          message: result.thread.failure?.message || 'Open Notesploy to see what happened.',
        });
      }
    } else if (result.outcome === 'timeout') {
      await setBadge(entry.tabId, 'clear');
      await notify(`thread:${entry.threadId}`, {
        title: 'Still working on it',
        message: 'Your save is still processing. Find it in your library.',
      });
    } else {
      await setBadge(entry.tabId, 'clear');
      await notify('auth:expired', {
        title: 'Reconnect Notesploy',
        message: 'Your session ended. Open the extension to reconnect.',
      });
    }
  } catch {
    await untrackPending(entry.threadId).catch(() => undefined);
  }
}

/** Resumes polling for captures that were in flight when the service worker stopped. */
export async function resumePending(): Promise<void> {
  const entries = await listPending();
  for (const entry of entries) {
    if (Date.now() - entry.startedAt >= POLL_TIMEOUT_MS) {
      await untrackPending(entry.threadId);
      continue;
    }
    void followCapture(entry);
  }
}
