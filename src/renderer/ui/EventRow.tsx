import type { Event } from '../../shared/model.js';
import { KIND } from '../kinds.js';
import { clock, tokens } from '../format.js';

/** One Event in a list. Used by the session Timeline and the Live feed alike. */
export function EventRow({
  event,
  active,
  onSelect,
}: {
  event: Event;
  active: boolean;
  onSelect: () => void;
}) {
  const [label, colour] = KIND[event.kind];
  return (
    <div
      className="event-row"
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        minHeight: 30,
        padding: `5px 12px 5px ${12 + event.depth * 18}px`,
        background: active ? 'var(--accentSoft)' : 'transparent',
        borderBottom: '1px solid var(--lineSoft)',
        borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
      }}
    >
      <span className="mono" style={{ color: 'var(--faint)', fontSize: 11 }}>
        {clock(event.at)}
      </span>
      <span
        className="mono"
        style={{
          color: colour,
          fontSize: 9.5,
          letterSpacing: '.08em',
          fontWeight: 600,
          width: 58,
          flex: 'none',
        }}
      >
        {label}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {event.title}
        {event.kind === 'think' && event.subtitle && (
          <span style={{ color: 'var(--faint)' }}> · {event.subtitle}</span>
        )}
        {event.failed && <span style={{ color: 'var(--err)' }}> · failed</span>}
      </span>
      <span
        className="num"
        style={{
          color: event.cost === null ? 'var(--faint)' : 'var(--dim)',
          flex: 'none',
          minWidth: 56,
        }}
        title={
          event.cost === null
            ? 'Could not be measured — the cached prefix was rebuilt, or this is the last request.'
            : event.sharedCost
              ? 'This request made several tool calls. The figure covers all of them and must not be summed.'
              : 'Tokens this added to the context.'
        }
      >
        {event.sharedCost ? '⊕ ' : ''}
        {tokens(event.cost)}
      </span>
    </div>
  );
}
