const DEFAULT_API_BASE = 'https://api.notesploy.com';
const DEFAULT_WEB_BASE = 'https://app.notesploy.com';

/** Trims whitespace and trailing slashes so paths can be appended safely. */
function normaliseBase(value: string | undefined, fallback: string): string {
  const trimmed = (value ?? '').trim();
  return (trimmed || fallback).replace(/\/+$/, '');
}

/** Set with WXT_API_BASE in .env (see .env.example). */
export const API_BASE = normaliseBase(import.meta.env.WXT_API_BASE, DEFAULT_API_BASE);

/** Set with WXT_WEB_BASE in .env (see .env.example). */
export const WEB_BASE = normaliseBase(import.meta.env.WXT_WEB_BASE, DEFAULT_WEB_BASE);

export const CLIENT_NAME = 'extension';

export const MAX_IMAGE_BYTES = 20_000_000;

export function threadUrl(threadId: string): string {
  return `${WEB_BASE}/threads/${threadId}`;
}

export const PLAN_SETTINGS_URL = `${WEB_BASE}/settings#plan`;
