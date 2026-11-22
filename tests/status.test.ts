import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/lib/api';
import { waitForThread } from '../src/lib/status';
import type { ThreadDetail } from '../src/lib/types';

vi.mock('wxt/browser', () => ({ browser: { storage: { local: {} } } }));

function thread(status: ThreadDetail['status']): ThreadDetail {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    sourceUrl: 'https://example.com',
    platform: 'web',
    title: 'Example',
    savedAt: '2026-11-22T00:00:00.000Z',
    updatedAt: '2026-11-22T00:00:00.000Z',
    status,
    limitations: [],
    revision: 1,
    currentRunId: null,
    failure: null,
  };
}

describe('waitForThread', () => {
  it('polls until the thread is ready', async () => {
    const fetchThread = vi
      .fn()
      .mockResolvedValueOnce(thread('queued'))
      .mockResolvedValueOnce(thread('processing'))
      .mockResolvedValueOnce(thread('ready'));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await waitForThread('t', { fetchThread, sleep, intervalMs: 3000 });

    expect(result.outcome).toBe('ready');
    expect(fetchThread).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it('gives up after the timeout', async () => {
    let clock = 0;
    const fetchThread = vi.fn().mockResolvedValue(thread('processing'));
    const result = await waitForThread('t', {
      fetchThread,
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
      intervalMs: 3000,
      timeoutMs: 9000,
    });

    expect(result.outcome).toBe('timeout');
  });

  it('stops on an unauthorized response', async () => {
    const fetchThread = vi.fn().mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'x'));
    const result = await waitForThread('t', { fetchThread, sleep: async () => undefined });
    expect(result.outcome).toBe('unauthorized');
  });
});
