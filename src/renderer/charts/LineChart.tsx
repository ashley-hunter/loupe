/**
 * A rate over time, drawn as a line with an explicit vertical range.
 *
 * Bars must start at zero, which makes them useless for a rate that only ever
 * moves between 90% and 100% — every bar looks full. A line may sit on a
 * non-zero baseline provided the range is stated, which it is, on the axis.
 */
export function LineChart({
  data,
  height = 72,
  label,
  unit = '%',
}: {
  data: Array<{ key: string; value: number | null; tip: string }>;
  height?: number;
  label: string;
  unit?: string;
}) {
  const values = data.map((d) => d.value).filter((v): v is number => v !== null);
  if (values.length === 0) {
    return (
      <div style={{ color: 'var(--faint)', fontSize: 11.5, padding: '8px 0' }}>
        Nothing recorded.
      </div>
    );
  }

  // A little headroom either side so the line never runs along the frame.
  const lo = Math.max(0, Math.floor(Math.min(...values) - 2));
  const hi = Math.min(100, Math.ceil(Math.max(...values) + 2));
  const span = Math.max(1, hi - lo);
  const y = (v: number): number => 100 - ((v - lo) / span) * 100;
  const x = (i: number): number => (data.length === 1 ? 50 : (i / (data.length - 1)) * 100);

  // Gaps break the line rather than interpolating across days with no data.
  const segments: Array<Array<[number, number]>> = [];
  let current: Array<[number, number]> = [];
  data.forEach((d, i) => {
    if (d.value === null) {
      if (current.length) segments.push(current);
      current = [];
      return;
    }
    current.push([x(i), y(d.value)]);
  });
  if (current.length) segments.push(current);

  return (
    <div style={{ display: 'flex', gap: 8, height }}>
      <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
        <svg
          role="img"
          aria-label={label}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          style={{ width: '100%', height: '100%', display: 'block' }}
        >
          {segments.map((seg, i) => (
            <polyline
              key={i}
              points={seg.map(([px, py]) => `${px},${py}`).join(' ')}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>

        {/* Hover targets sit above the line and are wider than the marks. */}
        <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
          {data.map((d) => (
            <div key={d.key} title={d.tip} style={{ flex: 1 }} />
          ))}
        </div>
      </div>

      {/*
        The range sits in its own gutter rather than over the plot — floated on
        top it collides with the line wherever the line happens to run high.
      */}
      <div
        className="mono"
        style={{
          width: 34,
          flex: 'none',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          fontSize: 10,
          color: 'var(--faint)',
        }}
      >
        <span>
          {hi}
          {unit}
        </span>
        <span>
          {lo}
          {unit}
        </span>
      </div>
    </div>
  );
}
