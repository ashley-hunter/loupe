import { useState } from 'react';
import { ChartTip } from './ChartTip.js';

/**
 * A day with no data is drawn as a gap, never as a zero-height bar: a quiet day
 * and a day you did not use Claude Code are different facts.
 */

const BAR_RADIUS = 4;

/** Stagger, capped so a long series does not take noticeably longer to arrive. */
const STEP_MS = 14;
const MAX_DELAY_MS = 220;

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
  const [hover, setHover] = useState<number | null>(null);
  const peak = Math.max(1, ...data.map((d) => d.value ?? 0));
  const active = hover === null ? null : data[hover];

  return (
    <div className="chart-plot" data-hovering={hover !== null} style={{ position: 'relative' }}>
      <div
        role="img"
        aria-label={label}
        style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height }}
        onPointerLeave={() => {
          setHover(null);
        }}
      >
        {data.map((d, i) => (
          <div
            key={d.key}
            // The hit target is the whole column, not the bar: a short bar is a
            // couple of pixels tall and would be untouchable otherwise.
            onPointerEnter={() => {
              setHover(i);
            }}
            style={{
              flex: 1,
              height: '100%',
              display: 'flex',
              alignItems: 'flex-end',
              minWidth: 0,
            }}
          >
            {d.value === null ? (
              // A gap, marked by a hairline on the baseline so the day is still there.
              <div style={{ width: '100%', height: 1, background: 'var(--line)' }} />
            ) : (
              <div
                className="chart-bar"
                data-on={hover === null || hover === i}
                style={{
                  width: '100%',
                  height: `${Math.max(2, (d.value / peak) * 100)}%`,
                  background: 'var(--accent)',
                  borderRadius: `${BAR_RADIUS}px ${BAR_RADIUS}px 0 0`,
                  animationDelay: `${Math.min(MAX_DELAY_MS, i * STEP_MS)}ms`,
                }}
              />
            )}
          </div>
        ))}
      </div>

      {active && (
        <ChartTip
          text={active.tip}
          x={((hover! + 0.5) / data.length) * 100}
          // Anchored to the top of its own bar, so the tip tracks the shape of
          // the series rather than floating at a fixed height.
          y={height - (active.value === null ? 0 : (active.value / peak) * height)}
        />
      )}
    </div>
  );
}
