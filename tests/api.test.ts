import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => {
  const data: Record<string, unknown> = {};
  const fake = {
    storage: {
      local: {
        async get(keys: string | string[]) {
          const list = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(list.filter((key) => key in data).map((key) => [key, data[key]]));
        },
        async set(items: Record<string, unknown>) {
          Object.assign(data, items);
        },
        async remove(keys: string | string[]) {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
        },
      },
    },
  };
  return { data, fake };
});

vi.mock('wxt/browser', () => ({ browser: harness.fake }));

import { ApiError, apiRequest, createCapture, exchangeCode, NETWORK_ERROR, UNAUTHORIZED } from '../src/lib/api';
import { API_BASE } from '../src/lib/config';

const TOKEN_KEY = 'notesploy.sessionToken';
const EXPIRED_KEY = 'notesploy.sessionExpired';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function lastRequest(mock: ReturnType<typeof vi.fn>): { url: string; init: RequestInit; headers: Headers } {
  const [url, init] = mock.mock.calls.at(-1) as [string, RequestInit];
  return { url, init, headers: new Headers(init.headers) };
}

describe('api wrapper', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    for (const key of Object.keys(harness.data)) delete harness.data[key];
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('sends the extension client header, bearer token and JSON content type', async () => {
    harness.data[TOKEN_KEY] = 'token-1';
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    await apiRequest('/api/usage');

    const { url, headers, init } = lastRequest(fetchMock);
    expect(url).toBe(`${API_BASE}/api/usage`);
    expect(init.method).toBe('GET');
    expect(headers.get('X-Notesploy-Client')).toBe('extension');
    expect(headers.get('Authorization')).toBe('Bearer token-1');
    expect(headers.get('Idempotency-Key')).toBeNull();
  });

  it('sends the idempotency key and JSON body on capture requests', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ threadId: 't', runId: 'r', status: 'queued' }, { status: 202 }));

    await createCapture({ kind: 'link', sourceUrl: 'https://example.com' }, 'key-123');

    const { init, headers } = lastRequest(fetchMock);
    expect(init.method).toBe('POST');
    expect(headers.get('Idempotency-Key')).toBe('key-123');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(JSON.parse(String(init.body))).toEqual({ kind: 'link', sourceUrl: 'https://example.com' });
  });

  it('replaces the stored token when the response rotates the session', async () => {
    harness.data[TOKEN_KEY] = 'old-token';
    fetchMock.mockResolvedValue(jsonResponse({}, { headers: { 'X-Notesploy-Session': 'new-token' } }));

    await apiRequest('/api/usage');

    expect(harness.data[TOKEN_KEY]).toBe('new-token');
  });

  it('clears the token and marks the session expired on 401', async () => {
    harness.data[TOKEN_KEY] = 'stale';
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'x', retryable: false } }, { status: 401 }),
    );

    const error = await apiRequest('/api/usage').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe(UNAUTHORIZED);
    expect(harness.data[TOKEN_KEY]).toBeUndefined();
    expect(harness.data[EXPIRED_KEY]).toBe(true);
  });

  it('parses the { error: { code, message } } body into an ApiError', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: { code: 'USAGE_LIMIT_EXCEEDED', message: 'Daily limit reached.', retryable: false } },
        { status: 429 },
      ),
    );

    const error = (await createCapture({ kind: 'link', sourceUrl: 'https://e.com' }, 'k').catch(
      (caught: unknown) => caught,
    )) as ApiError;

    expect(error.status).toBe(429);
    expect(error.code).toBe('USAGE_LIMIT_EXCEEDED');
    expect(error.message).toBe('Daily limit reached.');
    expect(error.retryable).toBe(false);
  });

  it('treats a non-JSON 5xx failure as a retryable error', async () => {
    fetchMock.mockResolvedValue(new Response('oops', { status: 503 }));

    const error = (await apiRequest('/api/usage').catch((caught: unknown) => caught)) as ApiError;

    expect(error.code).toBe('HTTP_ERROR');
    expect(error.retryable).toBe(true);
  });

  it('reports network failures as retryable NETWORK_ERROR', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const error = (await apiRequest('/api/usage').catch((caught: unknown) => caught)) as ApiError;

    expect(error.code).toBe(NETWORK_ERROR);
    expect(error.retryable).toBe(true);
  });

  it('sends no bearer token during the connect exchange and returns the body token', async () => {
    harness.data[TOKEN_KEY] = 'should-not-be-sent';
    fetchMock.mockResolvedValue(jsonResponse({ sessionToken: 'fresh' }));

    const token = await exchangeCode('code-abc', 'verifier-xyz');

    const { headers, init } = lastRequest(fetchMock);
    expect(headers.get('Authorization')).toBeNull();
    expect(headers.get('X-Notesploy-Client')).toBe('extension');
    expect(JSON.parse(String(init.body))).toEqual({ code: 'code-abc', verifier: 'verifier-xyz' });
    expect(token).toBe('fresh');
  });
});
