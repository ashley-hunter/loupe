import { Tooltip } from './Tooltip.js';

/**
 * A labelled figure.
 *
 * `lg` is the headline size used on Analytics; `md` is the size used in the
 * strips on Detail, Live and Projects.
 */
export function Stat({
  label,
  value,
  note,
  hint,
  tone,
  size = 'md',
}: {
  label: string;
  value: string;
  /** Small text under the figure. */
  note?: string | undefined;
  /** Tooltip, for anything that needs explaining rather than showing. */
  hint?: string | undefined;
  tone?: string | undefined;
  size?: 'md' | 'lg';
}) {
  return (
    <Tooltip text={hint}>
      <div style={{ minWidth: size === 'lg' ? 108 : 80 }}>
        <div className="eyebrow" style={{ marginBottom: size === 'lg' ? 3 : 2 }}>
          {label}
        </div>
        <div
          className="mono"
          style={{
            fontSize: size === 'lg' ? 19 : 14,
            letterSpacing: size === 'lg' ? '-.01em' : undefined,
            color: tone ?? 'var(--fg)',
          }}
        >
          {value}
        </div>
        {note !== undefined && (
          <div style={{ color: 'var(--faint)', fontSize: size === 'lg' ? 11 : 10, marginTop: 2 }}>
            {note}
          </div>
        )}
      </div>
    </Tooltip>
  );
}
