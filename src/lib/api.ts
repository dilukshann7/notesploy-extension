import { API_BASE, CLIENT_NAME } from './config';
import { expireSession, getSessionToken, storeSessionToken } from './session';
import type {
  ApiErrorBody,
  CaptureAccepted,
  CaptureInput,
  ThreadDetail,
  ThreadList,
  UploadInput,
  UploadSession,
  UsageSummary,
} from './types';

export const NETWORK_ERROR = 'NETWORK_ERROR';
export const UNAUTHORIZED = 'UNAUTHORIZED';
export const USAGE_LIMIT_EXCEEDED = 'USAGE_LIMIT_EXCEEDED';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;

  constructor(status: number, code: string, message: string, retryable = false) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** JSON body. */
  body?: unknown;
  /** Raw bytes (for upload PUT). Sent as application/octet-stream unless contentType is set. */
  rawBody?: Blob;
  contentType?: string;
  idempotencyKey?: string;
  /** Set false for the connect exchange, which must not send a stale token. */
  auth?: boolean;
  signal?: AbortSignal;
}

async function errorFromResponse(response: Response): Promise<ApiError> {
  let parsed: Partial<ApiErrorBody> | undefined;
  try {
    parsed = (await response.json()) as Partial<ApiErrorBody>;
  } catch {
    parsed = undefined;
  }
  const error = parsed?.error;
  if (error && typeof error.code === 'string') {
    return new ApiError(
      response.status,
      error.code,
      typeof error.message === 'string' ? error.message : `Request failed (${response.status}).`,
      error.retryable === true,
    );
  }
  return new ApiError(
    response.status,
    'HTTP_ERROR',
    `Request failed (${response.status}).`,
    response.status >= 500,
  );
}

/**
 * One fetch wrapper for every API call. Sends the extension client header and bearer token,
 * stores rotated sessions (X-Notesploy-Session), and turns 401 into a cleared token.
 */
export async function apiRequest<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers({ 'X-Notesploy-Client': CLIENT_NAME });
  if (options.auth !== false) {
    const token = await getSessionToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }

  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(options.body);
  } else if (options.rawBody) {
    headers.set('Content-Type', options.contentType ?? 'application/octet-stream');
    body = options.rawBody;
  }
  if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey);

  const method = options.method ?? (body !== undefined ? 'POST' : 'GET');

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { method, headers, body, signal: options.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, NETWORK_ERROR, 'Could not reach Notesploy. Check your connection and try again.', true);
  }

  if (response.status === 401) {
    await expireSession();
    throw new ApiError(401, UNAUTHORIZED, 'Your Notesploy session ended. Reconnect to continue.');
  }

  const rotated = response.headers.get('X-Notesploy-Session');
  if (rotated) await storeSessionToken(rotated);

  if (!response.ok) throw await errorFromResponse(response);
  if (response.status === 204) return undefined as T;

  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** POST /api/threads. The idempotency key must be reused when retrying the same user action. */
export function createCapture(input: CaptureInput, idempotencyKey: string): Promise<CaptureAccepted> {
  return apiRequest<CaptureAccepted>('/api/threads', { method: 'POST', body: input, idempotencyKey });
}

export function getThread(threadId: string): Promise<ThreadDetail> {
  return apiRequest<ThreadDetail>(`/api/threads/${encodeURIComponent(threadId)}`);
}

export function listRecentThreads(limit = 5): Promise<ThreadList> {
  return apiRequest<ThreadList>(`/api/threads?limit=${limit}`);
}

export function getUsage(): Promise<UsageSummary> {
  return apiRequest<UsageSummary>('/api/usage');
}

export function createUpload(input: UploadInput, idempotencyKey: string): Promise<UploadSession> {
  return apiRequest<UploadSession>('/api/uploads', { method: 'POST', body: input, idempotencyKey });
}

/** PUT to the relative uploadUrl returned by createUpload (for example /api/uploads/{id}). */
export async function transferUpload(uploadUrl: string, bytes: Blob): Promise<void> {
  await apiRequest<void>(uploadUrl, { method: 'PUT', rawBody: bytes, contentType: 'application/octet-stream' });
}

export function completeUpload(uploadId: string): Promise<CaptureAccepted> {
  return apiRequest<CaptureAccepted>(`/api/uploads/${encodeURIComponent(uploadId)}/complete`, { method: 'POST' });
}

export async function cancelUpload(uploadId: string): Promise<void> {
  await apiRequest<void>(`/api/uploads/${encodeURIComponent(uploadId)}`, { method: 'DELETE' });
}

/** POST /api/auth/native/exchange. Returns the session token from the JSON body. */
export async function exchangeCode(code: string, verifier: string): Promise<string | undefined> {
  const body = await apiRequest<{ sessionToken?: unknown }>('/api/auth/native/exchange', {
    method: 'POST',
    body: { code, verifier },
    auth: false,
  });
  return typeof body?.sessionToken === 'string' && body.sessionToken ? body.sessionToken : undefined;
}
