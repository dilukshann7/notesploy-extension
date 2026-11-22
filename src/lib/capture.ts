import { MAX_IMAGE_BYTES } from './config';
import type { CaptureInput } from './types';

export const HIGHLIGHT_MIN_CHARS = 20;
export const HIGHLIGHT_MAX_CHARS = 60_000;
export const PAGE_MIN_CHARS = 20;
// The API accepts 200,000 but only reads the first 60,000 characters, and its 256 KB JSON body
// limit would reject 200,000 characters of non-Latin text. Sending 60,000 keeps every page under it.
export const PAGE_MAX_CHARS = 60_000;
export const TITLE_MAX_CHARS = 300;

/** Raised for user-facing input problems, before any network call. */
export class CaptureInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaptureInputError';
  }
}

/**
 * Caps text at `max` UTF-16 units without splitting a surrogate pair.
 * Matches the API's string length rule (zod counts UTF-16 units).
 */
export function capText(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = max;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return text.slice(0, end);
}

/** Trims, caps at `max`, and rejects text shorter than `min`. */
export function prepareText(raw: string, min: number, max: number): string {
  const text = capText(raw.trim(), max).trim();
  if (text.length < min) {
    throw new CaptureInputError(`This needs at least ${min} characters of text.`);
  }
  return text;
}

function cleanTitle(title: string | undefined): string | undefined {
  const trimmed = title?.replace(/\s+/g, ' ').trim();
  if (!trimmed) return undefined;
  return capText(trimmed, TITLE_MAX_CHARS);
}

export function isWebUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function buildLinkBody(sourceUrl: string): CaptureInput {
  if (!isWebUrl(sourceUrl)) {
    throw new CaptureInputError("This page can't be saved. Open a web page and try again.");
  }
  return { kind: 'link', sourceUrl };
}

export function buildHighlightBody(input: { sourceUrl: string; text: string; title?: string }): CaptureInput {
  const body: CaptureInput = {
    kind: 'highlight',
    sourceUrl: input.sourceUrl,
    pastedText: prepareText(input.text, HIGHLIGHT_MIN_CHARS, HIGHLIGHT_MAX_CHARS),
  };
  const title = cleanTitle(input.title);
  if (title) body.title = title;
  return body;
}

export function buildPageBody(input: { sourceUrl: string; text: string; title?: string }): CaptureInput {
  const body: CaptureInput = {
    kind: 'page',
    sourceUrl: input.sourceUrl,
    pastedText: prepareText(input.text, PAGE_MIN_CHARS, PAGE_MAX_CHARS),
  };
  const title = cleanTitle(input.title);
  if (title) body.title = title;
  return body;
}

export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic';

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx']);

/** Identifies JPEG, PNG, WebP or HEIC from the file's leading bytes. Returns null otherwise. */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp') {
    const brand = String.fromCharCode(...bytes.slice(8, 12));
    if (HEIC_BRANDS.has(brand)) return 'image/heic';
  }
  return null;
}

export const IMAGE_TYPE_ERROR = 'Only JPEG, PNG, WebP and HEIC images can be saved.';
export const IMAGE_SIZE_ERROR = 'Images must be 20 MB or smaller.';

export function assertImageSize(sizeBytes: number): void {
  if (sizeBytes > MAX_IMAGE_BYTES) throw new CaptureInputError(IMAGE_SIZE_ERROR);
}

const EXTENSIONS: Record<ImageType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

/** Builds a safe filename (1 to 255 characters) with an extension that matches the sniffed type. */
export function imageFilename(sourceUrl: string, type: ImageType): string {
  let base = 'image';
  try {
    const url = new URL(sourceUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('not a web URL');
    const last = decodeURIComponent(url.pathname.split('/').pop() ?? '');
    const stem = last.replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    if (stem) base = stem.slice(0, 200);
  } catch {
    // Keep the default name for data: URLs and malformed paths.
  }
  return `${base}.${EXTENSIONS[type]}`;
}
