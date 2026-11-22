import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { WEB_BASE, PLAN_SETTINGS_URL, threadUrl } from '../../src/lib/config';
import { formatResetTime } from '../../src/lib/ui';
import type { ActionReply, PopupMessage, PopupState } from '../../src/lib/messages';
import type { ThreadStatus } from '../../src/lib/types';

const STATUS_LABEL: Record<ThreadStatus, string> = {
  queued: 'Queued',
  processing: 'Processing',
  ready: 'Ready',
  partial: 'Ready (partial)',
  failed: 'Failed',
};

function send(message: PopupMessage): Promise<ActionReply> {
  return browser.runtime.sendMessage(message) as Promise<ActionReply>;
}

function openUrl(url: string) {
  void browser.tabs.create({ url });
}

function App() {
  const [state, setState] = useState<PopupState | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [limitReached, setLimitReached] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const reply = await send({ type: 'state' });
    if (reply.state) setState(reply.state);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Runs one action, then shows its result and refreshes the state. */
  async function run(message: PopupMessage) {
    setBusy(true);
    setNotice(null);
    setLimitReached(null);
    try {
      const reply = await send(message);
      if (reply.state) setState(reply.state);
      if (reply.ok) {
        setNotice({ text: reply.message ?? 'Done.', error: false });
      } else if (reply.code === 'USAGE_LIMIT_EXCEEDED') {
        setLimitReached(reply.resetsAt ?? null);
      } else {
        setNotice({ text: reply.message ?? 'Something went wrong. Try again.', error: true });
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return <main className="panel"><p className="muted">Loading…</p></main>;
  }

  if (!state.connected) {
    return (
      <main className="panel">
        <header className="header">
          <h1>Notesploy</h1>
        </header>
        {state.sessionExpired ? (
          <p className="notice error">Your session ended. Reconnect to keep saving.</p>
        ) : (
          <p className="muted">Connect your account to save pages, highlights and images.</p>
        )}
        {notice && <p className={`notice ${notice.error ? 'error' : ''}`}>{notice.text}</p>}
        <button className="primary" disabled={busy} onClick={() => run({ type: 'connect' })}>
          {state.sessionExpired ? 'Reconnect' : 'Connect Notesploy'}
        </button>
      </main>
    );
  }

  const usage = state.usage;
  const remaining = usage?.remaining.links;
  const limit = usage?.limits.links;
  const exhausted = (remaining !== undefined && remaining <= 0) || limitReached !== null;
  const resetsAt = limitReached ?? usage?.resetsAt;

  return (
    <main className="panel">
      <header className="header">
        <h1>Notesploy</h1>
        {usage && <span className="plan">{usage.plan === 'free' ? 'Free plan' : usage.plan === 'pro' ? 'Pro' : 'Unlimited'}</span>}
      </header>

      {usage && usage.plan !== 'unlimited' && remaining !== undefined && (
        <p className="usage">
          {exhausted
            ? `You've used today's free saves.`
            : `${remaining} of ${limit ?? '?'} saves left today`}
          {exhausted && resetsAt && <span className="muted"> Resets {formatResetTime(resetsAt)}.</span>}
        </p>
      )}

      {exhausted && usage?.plan !== 'pro' && (
        <button className="primary" onClick={() => openUrl(PLAN_SETTINGS_URL)}>
          Try Pro free for 7 days
        </button>
      )}

      <div className="actions">
        <button className="primary" disabled={busy || exhausted} onClick={() => run({ type: 'savePage' })}>
          Save this page
        </button>
        <button disabled={busy || exhausted} onClick={() => run({ type: 'saveVisible' })}>
          Save what I see
        </button>
      </div>

      {state.fallback && (
        <div className="fallback">
          <p className="muted">Notesploy couldn't read {state.fallback.url}.</p>
          <button disabled={busy || exhausted} onClick={() => run({ type: 'saveFallback' })}>
            Save what I see on that page
          </button>
        </div>
      )}

      {notice && <p className={`notice ${notice.error ? 'error' : ''}`}>{notice.text}</p>}

      <section>
        <h2>Recent saves</h2>
        {state.recent.length === 0 ? (
          <p className="muted">Nothing saved yet.</p>
        ) : (
          <ul className="recent">
            {state.recent.map((thread) => (
              <li key={thread.id}>
                <button className="link" onClick={() => openUrl(threadUrl(thread.id))}>
                  <span className="title">{thread.title || thread.sourceUrl || 'Untitled'}</span>
                  <span className={`status ${thread.status}`}>{STATUS_LABEL[thread.status]}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="footer">
        <button className="link" onClick={() => openUrl(WEB_BASE)}>Open library</button>
        <button className="link" disabled={busy} onClick={() => run({ type: 'signOut' })}>Sign out</button>
      </footer>
    </main>
  );
}

export default App;
