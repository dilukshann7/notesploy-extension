import { browser } from 'wxt/browser';

export type BadgeState = 'saving' | 'saved' | 'error' | 'clear';

const BADGE: Record<BadgeState, { text: string; color: string }> = {
  saving: { text: '…', color: '#6b7280' },
  saved: { text: '✓', color: '#15803d' },
  error: { text: '!', color: '#b91c1c' },
  clear: { text: '', color: '#6b7280' },
};

/** Per-tab toolbar badge. Ignored when the tab has gone. */
export async function setBadge(tabId: number | undefined, state: BadgeState): Promise<void> {
  const { text, color } = BADGE[state];
  const target = tabId === undefined ? {} : { tabId };
  try {
    await browser.action.setBadgeBackgroundColor({ ...target, color });
    await browser.action.setBadgeText({ ...target, text });
  } catch {
    // The tab may have closed while saving.
  }
}

export function notificationIconUrl(): string {
  return browser.runtime.getURL('/icon/128.png');
}

export interface NotifyOptions {
  title: string;
  message: string;
  buttons?: string[];
}

export async function notify(id: string, options: NotifyOptions): Promise<void> {
  try {
    await browser.notifications.create(id, {
      type: 'basic',
      iconUrl: notificationIconUrl(),
      title: options.title,
      message: options.message,
      ...(options.buttons?.length ? { buttons: options.buttons.map((title) => ({ title })) } : {}),
    });
  } catch {
    // Notifications can be disabled by the user or the OS.
  }
}

export function formatResetTime(iso: string | undefined): string {
  if (!iso) return 'tomorrow';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'tomorrow';
  return date.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

export const LIMIT_MESSAGE = "You've used today's free saves.";
