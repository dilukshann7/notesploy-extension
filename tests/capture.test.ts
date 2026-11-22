import { describe, expect, it } from 'vitest';
import {
  assertImageSize,
  buildHighlightBody,
  buildLinkBody,
  buildPageBody,
  capText,
  CaptureInputError,
  imageFilename,
  prepareText,
  sniffImageType,
} from '../src/lib/capture';

const LONG = 'a'.repeat(30);
const bytes = (text: string) => new TextEncoder().encode(text);

describe('capture bodies', () => {
  it('builds a link body with only kind and sourceUrl', () => {
    expect(buildLinkBody('https://example.com/a')).toEqual({ kind: 'link', sourceUrl: 'https://example.com/a' });
  });

  it('rejects non-web links before any request', () => {
    expect(() => buildLinkBody('chrome://extensions')).toThrow(CaptureInputError);
    expect(() => buildLinkBody('')).toThrow(CaptureInputError);
  });

  it('builds a highlight body with trimmed text and an optional title', () => {
    expect(
      buildHighlightBody({ sourceUrl: 'https://example.com', text: `  ${LONG}  `, title: '  Example  ' }),
    ).toEqual({ kind: 'highlight', sourceUrl: 'https://example.com', pastedText: LONG, title: 'Example' });
  });

  it('omits a blank title', () => {
    const body = buildHighlightBody({ sourceUrl: 'https://example.com', text: LONG, title: '   ' });
    expect(body).not.toHaveProperty('title');
  });

  it('rejects highlights shorter than 20 characters', () => {
    expect(() => buildHighlightBody({ sourceUrl: 'https://example.com', text: 'too short' })).toThrow(
      /at least 20 characters/,
    );
  });

  it('caps highlight text at 60000 characters', () => {
    const body = buildHighlightBody({ sourceUrl: 'https://example.com', text: 'b'.repeat(70_000) });
    expect(body.kind === 'highlight' && body.pastedText.length).toBe(60_000);
  });

  it('builds a page body and caps text at 60000 characters', () => {
    const body = buildPageBody({ sourceUrl: 'https://example.com', text: 'c'.repeat(250_000), title: 'Page' });
    expect(body).toMatchObject({ kind: 'page', sourceUrl: 'https://example.com', title: 'Page' });
    expect(body.kind === 'page' && body.pastedText.length).toBe(60_000);
  });

  it('rejects page text shorter than 20 characters after trimming', () => {
    expect(() => buildPageBody({ sourceUrl: 'https://example.com', text: '   short   ' })).toThrow(CaptureInputError);
  });
});

describe('text capping', () => {
  it('leaves short text untouched', () => {
    expect(capText('hello', 10)).toBe('hello');
  });

  it('does not split a surrogate pair at the cap', () => {
    const text = `${'x'.repeat(4)}\u{1F600}`; // emoji is two UTF-16 units
    expect(capText(text, 5)).toBe('xxxx');
    expect(prepareText(text, 1, 5)).toBe('xxxx');
  });
});

describe('image sniffing', () => {
  it('recognises JPEG, PNG, WebP and HEIC by their leading bytes', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const webp = bytes('RIFF\0\0\0\0WEBPVP8 ');
    const heic = bytes('\0\0\0\u0018ftypheic');
    expect(sniffImageType(jpeg)).toBe('image/jpeg');
    expect(sniffImageType(png)).toBe('image/png');
    expect(sniffImageType(webp)).toBe('image/webp');
    expect(sniffImageType(heic)).toBe('image/heic');
  });

  it('returns null for GIF, SVG and HTML content', () => {
    expect(sniffImageType(bytes('GIF89a......'))).toBeNull();
    expect(sniffImageType(bytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(sniffImageType(bytes('<!doctype html>'))).toBeNull();
  });

  it('builds a filename with an extension matching the sniffed type', () => {
    expect(imageFilename('https://cdn.example.com/photos/Sunset%20Beach.PNG?x=1', 'image/jpeg')).toBe(
      'Sunset-Beach.jpg',
    );
    expect(imageFilename('data:image/png;base64,AAAA', 'image/png')).toBe('image.png');
  });

  it('enforces the 20 MB limit', () => {
    expect(() => assertImageSize(20_000_000)).not.toThrow();
    expect(() => assertImageSize(20_000_001)).toThrow(/20 MB/);
  });
});
