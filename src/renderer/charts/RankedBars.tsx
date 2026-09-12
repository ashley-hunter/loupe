/**
 * A ranked list with a magnitude bar per row.
 *
 * Rows are directly labelled, so the bar carries no identity and one hue is
 * correct. `tone` exists for the rare case where a row's shade is keyed to what
 * it is — never to where it ranks, which would repaint rows when the order moves.
 */
export function RankedBars({
  rows,
  onSelect,
}: {
  rows: Array<{
    key: string;
    label: string;
    value: string;
    fraction: number;
    tone?: string;
    meta?: string;
  }>;
  onSelect?: (key: string) => void;
}) {
  return (
    <div>
      {rows.map((r) => (
        <div
          key={r.key}
          className="group-row"
          onClick={
            onSelect
              ? () => {
                  onSelect(r.key);
                }
              : undefined
          }
          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 0' }}
        >
          <div style={{ width: 148, flex: 'none', minWidth: 0 }}>
            <div className="ellipsis" style={{ fontSize: 12 }}>
              {r.label}
            </div>
            {r.meta && (
              <div className="mono ellipsis" style={{ fontSize: 10, color: 'var(--faint)' }}>
                {r.meta}
              </div>
            )}
          </div>
          <div
            style={{
              flex: 1,
              minWidth: 40,
              height: 6,
              background: 'var(--track)',
              borderRadius: 3,
              marginRight: 4,
              // A bad fraction must never let a bar escape its track and run
              // under the value beside it.
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${Math.min(100, Math.max(1, r.fraction * 100))}%`,
                height: '100%',
                borderRadius: 3,
                background: r.tone ?? 'var(--accent)',
              }}
            />
          </div>
          <div className="num" style={{ width: 82, flex: 'none', color: 'var(--fg)' }}>
            {r.value}
          </div>
        </div>
      ))}
    </div>
  );
}
