import { Collapsible } from '@base-ui-components/react/collapsible';
import { useState } from 'react';
import { useAsync } from './useAsync.js';
import { Failed } from './ui/Failed.js';
import type { CacheSummary } from '../main/invalidations.js';
import type { Invalidation, InvalidationCause } from '../shared/model.js';
import { duration, tokens, when } from './format.js';
import { Empty } from './ui/Empty.js';
import { TopBar } from './ui/TopBar.js';

type Report = CacheSummary & { all: Invalidation[] };

const GRID = { gridTemplateColumns: '128px minmax(180px,2fr) 120px minmax(160px,1fr) 96px' };
const EXPIRY_GRID = { gridTemplateColumns: '128px minmax(200px,1fr) 110px 96px' };

const CAUSE: Record<InvalidationCause, string> = {
  'model-change': 'Model changed',
  expiry: 'Expired while idle',
  reanchor: 'Prefix re-anchored',
  compaction: 'Context compacted',
  undetermined: 'Cause not determined',
};

export function Cache() {
  const [showExpiry, setShowExpiry] = useState(false);
  const state = useAsync<Report>(() => window.loupe.cache());

  if (state.status === 'loading') return <Empty>Reading transcripts…</Empty>;
  if (state.status === 'failed')
    return <Failed what="read the cache history" error={state.error} />;
  const report = state.data;

  const { avoidable, expiry } = report;
  const avoidableTokens = avoidable.reduce((n, i) => n + i.rewritten, 0);
  const expired = report.all.filter((i) => i.cause === 'expiry');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <TopBar title="Cache" count={report.all.length} />

      <div style={{ overflow: 'auto', minHeight: 0, flex: 1, padding: 16 }}>
        <Heading
          title="Avoidable"
          note={`${avoidable.length} · ${tokens(avoidableTokens)} rewritten`}
        />
        <p style={{ color: 'var(--dim)', margin: '0 0 10px', maxWidth: 560, lineHeight: 1.5 }}>
          Something during the session rebuilt the cached prefix. Doing the same thing before the
          session starts avoids the cost.
        </p>

        {avoidable.length === 0 && (
          <Empty>No avoidable invalidations. Every rebuild was idle expiry.</Empty>
        )}

        {avoidable.length > 0 && (
          <div
            style={{
              marginBottom: 28,
              border: '1px solid var(--line)',
              borderRadius: 6,
              overflow: 'hidden',
            }}
          >
            <div
              className="thead"
              style={{ ...GRID, position: 'static', background: 'var(--panel)' }}
            >
              <div>When</div>
              <div>Session</div>
              <div>Project</div>
              <div>Cause</div>
              <div style={{ textAlign: 'right' }}>Rewritten</div>
            </div>
            {avoidable.map((i, n) => (
              <div
                className="trow"
                key={`${i.sessionId}-${i.at}-${n}`}
                style={{ ...GRID, height: 36 }}
              >
                <div style={{ fontSize: 11.5, color: 'var(--dim)', whiteSpace: 'nowrap' }}>
                  {when(i.at)}
                </div>
                <div className="ellipsis" style={{ paddingRight: 10 }}>
                  {i.sessionName}
                </div>
                <div className="mono ellipsis" style={{ fontSize: 11.5, color: 'var(--dim)' }}>
                  {i.project}
                </div>
                <div className="ellipsis" style={{ fontSize: 12 }}>
                  <span
                    style={{ color: i.cause === 'undetermined' ? 'var(--faint)' : 'var(--fg)' }}
                  >
                    {CAUSE[i.cause]}
                  </span>
                  {i.detail && (
                    <span className="mono" style={{ color: 'var(--faint)', fontSize: 11 }}>
                      {' '}
                      · {i.detail}
                    </span>
                  )}
                </div>
                <div className="num" style={{ color: 'var(--err)' }}>
                  {tokens(i.rewritten)}
                </div>
              </div>
            ))}
          </div>
        )}

        <Heading
          title="Grew past incremental caching"
          note={`${report.reanchor.count} · ${tokens(report.reanchor.rewritten)} rewritten`}
        />
        <p style={{ color: 'var(--dim)', margin: '0 0 22px', maxWidth: 560, lineHeight: 1.5 }}>
          The prefix was rebuilt above a small stable base, seconds after the previous request — too
          soon to be idle expiry and with no model change. This happens as a conversation grows very
          large. Nothing was done wrong; the lever is starting a fresh session sooner.
        </p>

        <Heading
          title="Context compacted"
          note={`${report.compaction.count} · ${tokens(report.compaction.rewritten)} rewritten`}
        />
        <p style={{ color: 'var(--dim)', margin: '0 0 22px', maxWidth: 560, lineHeight: 1.5 }}>
          The context did not move, it shrank — compaction replaced it with a summary, so the
          rebuild is small and the saving is large. Counted here so the totals reconcile, but this
          is the cache working, not waste.
        </p>

        <Heading
          title="Expired while idle"
          note={`${expiry.count} · ${tokens(expiry.rewritten)} rewritten`}
        />
        <p style={{ color: 'var(--dim)', margin: '0 0 10px', maxWidth: 560, lineHeight: 1.5 }}>
          The gap since the previous request exceeded the cache lifetime. This is how caching works,
          not a mistake, so it is counted rather than listed.
          {expiry.count > 0 && ` Average gap ${duration(expiry.averageIdleMs)}.`}
        </p>

        {expiry.count > 0 && (
          <>
            <Collapsible.Root open={showExpiry} onOpenChange={setShowExpiry}>
              <Collapsible.Trigger
                style={{
                  border: 'none',
                  background: 'none',
                  color: 'var(--accent)',
                  padding: '4px 0',
                  fontSize: 12,
                }}
              >
                {showExpiry ? '▾ Hide' : '▸ Show'} {expiry.count} expiries
              </Collapsible.Trigger>
              <Collapsible.Panel className="collapsible-panel">
                <div
                  style={{
                    marginTop: 6,
                    border: '1px solid var(--line)',
                    borderRadius: 6,
                    overflow: 'hidden',
                  }}
                >
                  {expired.map((i, n) => (
                    <div
                      className="trow"
                      key={`${i.sessionId}-${i.at}-${n}`}
                      style={{ ...EXPIRY_GRID, height: 32 }}
                    >
                      <div style={{ fontSize: 11.5, color: 'var(--dim)', whiteSpace: 'nowrap' }}>
                        {when(i.at)}
                      </div>
                      <div className="ellipsis" style={{ paddingRight: 10, fontSize: 12 }}>
                        {i.sessionName}
                      </div>
                      <div className="mono" style={{ fontSize: 11, color: 'var(--faint)' }}>
                        idle {duration(i.idleMs)}
                      </div>
                      <div className="num">{tokens(i.rewritten)}</div>
                    </div>
                  ))}
                </div>
              </Collapsible.Panel>
            </Collapsible.Root>
          </>
        )}
      </div>
    </div>
  );
}

const Heading = ({ title, note }: { title: string; note: string }) => (
  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 5 }}>
    <h2 style={{ margin: 0, fontSize: 13.5, fontWeight: 650, letterSpacing: '-.01em' }}>{title}</h2>
    <span className="mono" style={{ color: 'var(--faint)', fontSize: 11 }}>
      {note}
    </span>
  </div>
);
