import { Meter as Base } from '@base-ui-components/react/meter';

/**
 * A measurement within a known range — which is what an allowance is.
 *
 * Hand-rolled this was a div inside a div, announced as nothing at all. The
 * primitive carries the role and the value, so it is readable without sight of
 * the bar.
 */
export function Meter({
  label,
  value,
  note,
}: {
  label: string;
  /** Percentage consumed, 0-100. */
  value: number;
  /** Small print under the bar, such as when the window resets. */
  note?: string | undefined;
}) {
  const colour = value >= 80 ? 'var(--err)' : value >= 50 ? 'var(--warn)' : 'var(--accent)';

  return (
    <Base.Root value={value} style={{ marginBottom: 7, display: 'block' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
        <Base.Label style={{ color: 'var(--dim)' }}>{label}</Base.Label>
        <Base.Value className="mono" style={{ color: 'var(--fg)' }} />
      </div>
      <Base.Track
        style={{
          display: 'block',
          height: 3,
          background: 'var(--track)',
          borderRadius: 2,
          marginTop: 3,
        }}
      >
        <Base.Indicator
          style={{ display: 'block', height: '100%', borderRadius: 2, background: colour }}
        />
      </Base.Track>
      {note !== undefined && (
        <div style={{ color: 'var(--faint)', fontSize: 10, marginTop: 2 }}>{note}</div>
      )}
    </Base.Root>
  );
}
