import { useEffect, useState } from 'react';
import type { Event } from '../../shared/model.js';
import { KIND } from '../kinds.js';
import { BLANK, clock, tokens } from '../format.js';

/**
 * The detail of one Event, beside the list it was picked from.
 *
 * Shared by the session Timeline and the Live feed: the same Event type with
 * the same fields, so a second copy would only drift.
 */
export function Inspector({
  event,
  collapseAbove,
}: {
  event: Event | null;
  collapseAbove: number;
}) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    setExpanded(false);
  }, [event?.id]);

  // Roughly four characters per token — enough to decide whether to collapse.
  const big =
    collapseAbove > 0 && event?.body !== undefined && event.body.length / 4 > collapseAbove;
  const collapsed = big && !expanded;

  return (
    <div
      style={{
        width: 340,
        flex: 'none',
        borderLeft: '1px solid var(--line)',
        overflow: 'auto',
        padding: 14,
        background: 'var(--panel)',
      }}
    >
      {!event && <div style={{ color: 'var(--faint)' }}>Select an event.</div>}
      {event && (
        <>
          <div
            className="mono"
            style={{
              color: KIND[event.kind][1],
              fontSize: 9.5,
              letterSpacing: '.08em',
              fontWeight: 600,
            }}
          >
            {KIND[event.kind][0]}
          </div>
          <div
            className="selectable"
            style={{ margin: '6px 0 12px', fontSize: 13, lineHeight: 1.45 }}
          >
            {event.title}
          </div>

          <Field label="Time" value={clock(event.at)} />
          {event.subtitle && <Field label="Tool" value={event.subtitle} />}
          <Field
            label="Added to context"
            value={event.cost === null ? `${BLANK} not measurable` : `${tokens(event.cost)} tokens`}
          />
          {event.sharedCost && (
            <div style={{ color: 'var(--warn)', fontSize: 11.5, margin: '8px 0', lineHeight: 1.4 }}>
              Shared with the other tool calls in this request. Correct for each, but do not add
              them together.
            </div>
          )}

          {event.body && (
            <>
              <div className="eyebrow" style={{ margin: '14px 0 5px' }}>
                Content
              </div>
              <pre
                className="selectable mono"
                style={{
                  margin: 0,
                  padding: 9,
                  fontSize: 11.5,
                  lineHeight: 1.45,
                  background: 'var(--codeBg)',
                  border: '1px solid var(--line)',
                  borderRadius: 5,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: collapsed ? 96 : 420,
                  overflow: 'auto',
                }}
              >
                {event.body}
              </pre>
              {big && (
                <button
                  onClick={() => {
                    setExpanded((v) => !v);
                  }}
                  style={{
                    border: 'none',
                    background: 'none',
                    color: 'var(--accent)',
                    fontSize: 11.5,
                    padding: '5px 0',
                  }}
                >
                  {collapsed
                    ? `Show all ~${Math.round(event.body.length / 4 / 1000)}k tokens`
                    : 'Collapse'}
                </button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 10,
        padding: '3px 0',
        fontSize: 12,
      }}
    >
      <span style={{ color: 'var(--faint)' }}>{label}</span>
      <span className="selectable" style={{ textAlign: 'right' }}>
        {value}
      </span>
    </div>
  );
}
