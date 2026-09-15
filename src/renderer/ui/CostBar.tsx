import { newTokens, type Usage } from '../../shared/model.js';
import { tokens } from '../format.js';

/**
 * What a conversation's tokens went on, as one bar.
 *
 * The app used to report a single "new tokens" figure, which tells you a
 * session was expensive and nothing about whether that was work or waste. Cache
 * writes are 84.8% of everything spent here, so the split between them and the
 * rest is the only number worth putting in a list row.
 *
 * Cache reads are deliberately absent. Every request re-reads the whole prefix,
 * so adding them in counts the same tokens once per request - 21M for a single
 * 172-request session - and would swamp everything true beside it.
 */
export function CostBar({
  usage,
  delegated = 0,
  scale = 1,
  className,
}: {
  usage: Usage;
  /** Subagent spend. Sits outside the session's own total, and is drawn apart. */
  delegated?: number;
  /**
   * This row's size against the largest in view, 0 to 1.
   *
   * Without it every bar is full width and only composition shows - and since
   * cache writes are most of everything, every row looked the same and the bar
   * said nothing. Length carries how much, the segments carry what of.
   */
  scale?: number;
  className?: string;
}) {
  const own = newTokens(usage);
  const total = own + delegated;
  if (total === 0) return <span className={className} />;

  const parts: Array<[string, number, string]> = [
    ['written to cache', usage.cacheWrite, 'var(--warn)'],
    ['produced', usage.output, 'var(--accent)'],
    ['fresh input', usage.input, 'var(--dim)'],
    ['delegated to agents', delegated, 'var(--blue)'],
  ];

  return (
    <span
      className={`costbar ${className ?? ''}`}
      style={{ width: `${String(Math.max(scale * 100, 1.5))}%` }}
      role="img"
      aria-label={parts
        .filter(([, n]) => n > 0)
        .map(([name, n]) => `${tokens(n)} ${name}`)
        .join(', ')}
    >
      {parts.map(([name, n, hue]) =>
        n === 0 ? null : (
          <span
            key={name}
            style={{ width: `${String((n / total) * 100)}%`, background: hue }}
            title={`${tokens(n)} ${name}`}
          />
        ),
      )}
    </span>
  );
}
