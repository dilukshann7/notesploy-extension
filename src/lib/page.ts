import { browser } from 'wxt/browser';

/*
 * Functions in this file are injected with scripting.executeScript, which serialises them.
 * They must be self-contained: no references to imports or module-level values.
 */

export interface VisiblePage {
  title: string;
  text: string;
}

/** Reads the document title and visible text (innerText), trimmed and capped at 60,000 characters (PAGE_MAX_CHARS). */
export function readVisiblePage(): VisiblePage {
  const body = document.body ?? document.documentElement;
  const raw = body.innerText || body.textContent || '';
  return {
    title: document.title || '',
    text: raw.replace(/[ \t]+\n/g, '\n').trim().slice(0, 60000),
  };
}

export type ToastState = 'saving' | 'saved' | 'error';

export interface ToastPayload {
  state: ToastState;
  message: string;
  linkLabel?: string;
  href?: string;
}

/** Shows (or replaces) the Notesploy toast in a Shadow DOM so page styles cannot leak in. */
export function renderToast(payload: ToastPayload): void {
  const existing = document.getElementById('notesploy-toast-host') as
    | (HTMLElement & { __notesployTimer?: number })
    | null;
  if (existing) {
    if (existing.__notesployTimer) window.clearTimeout(existing.__notesployTimer);
    existing.remove();
  }

  const host = document.createElement('div') as HTMLElement & { __notesployTimer?: number };
  host.id = 'notesploy-toast-host';
  host.style.all = 'initial';
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    .toast {
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
      max-width: 320px; box-sizing: border-box; padding: 10px 14px; border-radius: 10px;
      font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
      background: #111827; color: #f9fafb; box-shadow: 0 8px 24px rgba(0,0,0,.25);
      display: flex; align-items: center; gap: 10px;
    }
    .toast.error { background: #7f1d1d; }
    .toast.saved { background: #14532d; }
    .message { flex: 1; }
    a { color: #bbf7d0; font-weight: 600; text-decoration: underline; white-space: nowrap; }
  `;
  root.appendChild(style);

  const toast = document.createElement('div');
  toast.className = `toast ${payload.state}`;
  toast.setAttribute('role', 'status');
  const message = document.createElement('span');
  message.className = 'message';
  message.textContent = payload.message;
  toast.appendChild(message);

  if (payload.href && payload.linkLabel) {
    const link = document.createElement('a');
    link.href = payload.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = payload.linkLabel;
    toast.appendChild(link);
  }
  root.appendChild(toast);

  // "Saving" stays until the next toast replaces it; results auto-dismiss after 4 seconds.
  if (payload.state !== 'saving') {
    host.__notesployTimer = window.setTimeout(() => host.remove(), 4000);
  }
}

export async function readVisiblePageFromTab(tabId: number): Promise<VisiblePage> {
  const [result] = await browser.scripting.executeScript({ target: { tabId }, func: readVisiblePage });
  const value = result?.result as VisiblePage | undefined;
  if (!value) throw new Error('This page cannot be read.');
  return value;
}

/** Best-effort: pages such as chrome:// or the web store cannot be scripted. */
export async function showToast(tabId: number | undefined, payload: ToastPayload): Promise<void> {
  if (tabId === undefined) return;
  try {
    await browser.scripting.executeScript({ target: { tabId }, func: renderToast, args: [payload] });
  } catch {
    // Ignore: the page cannot host a toast.
  }
}
