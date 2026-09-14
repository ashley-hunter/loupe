import { Info } from 'lucide-react';
import type { Recommendation } from '../shared/model.js';
import { ICON } from './App.js';
import { useAsync } from './useAsync.js';
import { Empty } from './ui/Empty.js';
import { Failed } from './ui/Failed.js';
import { TopBar } from './ui/TopBar.js';

/**
 * Things worth changing whose saving cannot be Measured.
 *
 * These used to sit at the bottom of Insights, below every Finding and only
 * while no category filter was on, which meant they were usually invisible.
 * They are a different kind of thing from a Finding — no token figure, nothing
 * to add to a total — so they get their own screen rather than a better spot on
 * someone else's.
 */
export function Recommendations() {
  const state = useAsync<Recommendation[]>(() => window.loupe.advice());

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <TopBar
        title="Recommendations"
        count={state.status === 'ready' ? state.data.length : undefined}
      />
      <div className="scroll-pane">
        <div className="pane-content" style={{ maxWidth: 820 }}>
          {state.status === 'loading' && <Empty>Looking at how the sessions are set up…</Empty>}
          {state.status === 'failed' && (
            <Failed what="read the recommendations" error={state.error} />
          )}
          {state.status === 'ready' && state.data.length === 0 && (
            <Empty align="left">
              Nothing to suggest. These come from how your sessions are configured rather than from
              what they cost — an MCP server that is never invoked, or a model doing work a cheaper
              one would do as well.
            </Empty>
          )}
          {state.status === 'ready' && state.data.length > 0 && (
            <>
              <p
                style={{
                  color: 'var(--faint)',
                  fontSize: 11.5,
                  margin: '0 0 14px',
                  lineHeight: 1.55,
                }}
              >
                Worth knowing, but not costable from the transcripts. These carry no token figure
                and are deliberately kept out of any total.
              </p>
              {state.data.map((r) => (
                <Advice key={r.id} recommendation={r} />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** A Recommendation card. Deliberately has no number where a Finding has one. */
function Advice({ recommendation: r }: { recommendation: Recommendation }) {
  return (
    <div
      style={{
        border: '1px solid var(--line)',
        borderRadius: 8,
        padding: '12px 14px',
        marginBottom: 10,
        background: 'var(--panel)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Info {...ICON} style={{ color: 'var(--dim)', flex: 'none' }} aria-hidden />
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{r.title}</span>
        <span className="mono" style={{ marginLeft: 'auto', color: 'var(--faint)', fontSize: 11 }}>
          not costable
        </span>
      </div>
      <p style={{ margin: '0 0 7px', lineHeight: 1.55, maxWidth: 640, color: 'var(--dim)' }}>
        {r.text}
      </p>
      <div className="mono" style={{ fontSize: 11, color: 'var(--faint)' }}>
        {r.detail}
      </div>
    </div>
  );
}
