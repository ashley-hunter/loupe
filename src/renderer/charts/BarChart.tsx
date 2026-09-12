/**
 * A day with no data is drawn as a gap, never as a zero-height bar: a quiet day
 * and a day you did not use Claude Code are different facts.
 */

const BAR_RADIUS = 4;

export function BarChart({
  data,
  height = 84,
  label,
}: {
  /** `value: null` means no data — drawn as a gap. */
  data: Array<{ key: string; value: number | null; tip: string }>;
  height?: number;
  label: string;
}) {
  const peak = Math.max(1, ...data.map((d) => d.value ?? 0));

  return (
    <div
      role="img"
      aria-label={label}
      style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height }}
    >
      {data.map((d) => (
        <div
          key={d.key}
          title={d.tip}
          style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end', minWidth: 0 }}
        >
          {d.value === null ? (
            // A gap, marked by a hairline on the baseline so the day is still there.
            <div style={{ width: '100%', height: 1, background: 'var(--line)' }} />
          ) : (
            <div
              style={{
                width: '100%',
                height: `${Math.max(2, (d.value / peak) * 100)}%`,
                background: 'var(--accent)',
                borderRadius: `${BAR_RADIUS}px ${BAR_RADIUS}px 0 0`,
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}
