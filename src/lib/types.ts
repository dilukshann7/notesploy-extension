// Hand-written subset of the API contracts used by the extension. Source of truth:
// notesploy-api/src/contracts/*.ts and contracts/openapi.json (see `npm run contracts:types`).

export type ThreadStatus = 'queued' | 'processing' | 'ready' | 'partial' | 'failed';

export type SourcePlatform =
  | 'article'
  | 'tiktok'
  | 'instagram'
  | 'web'
  | 'upload'
  | 'highlight'
  | 'image'
  | 'pdf'
  | 'audio';

export interface ProcessingFailure {
  code: string;
  message: string;
  retryable: boolean;
}

export interface CaptureAccepted {
  threadId: string;
  runId: string;
  status: ThreadStatus;
}

/** Bodies for POST /api/threads (contract: link, highlight, page). */
export type CaptureInput =
  | { kind: 'link'; sourceUrl: string }
  | { kind: 'highlight'; sourceUrl: string; pastedText: string; title?: string }
  | { kind: 'page'; sourceUrl: string; pastedText: string; title?: string };

export interface ThreadListItem {
  id: string;
  sourceUrl: string | null;
  platform: SourcePlatform;
  title: string;
  savedAt: string;
  updatedAt: string;
  status: ThreadStatus;
  limitations: string[];
  revision: number;
}

export interface ThreadDetail extends ThreadListItem {
  currentRunId: string | null;
  failure: ProcessingFailure | null;
}

export interface ThreadList {
  items: ThreadListItem[];
  nextCursor: string | null;
}

export interface UsageCounters {
  links: number;
  videoMs: number;
  completionRequests: number;
  transformations: number;
  tokens: number;
  bytes: number;
}

export interface UsageSummary {
  plan: 'free' | 'pro' | 'unlimited';
  limits: UsageCounters & { concurrent: number };
  used: UsageCounters;
  reserved: UsageCounters;
  remaining: UsageCounters;
  activeJobs: number;
  resetsAt: string;
}

export interface UploadSession {
  uploadId: string;
  uploadUrl: string;
  kind: 'video' | 'image' | 'pdf' | 'audio';
  state: 'pending' | 'uploading' | 'stored' | 'accepted' | 'cancelled' | 'rejected';
  expiresAt: string;
  maxBytes: number;
  accepted: CaptureAccepted | null;
}

export interface UploadInput {
  kind: 'image';
  filename: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    retryable: boolean;
  };
}
