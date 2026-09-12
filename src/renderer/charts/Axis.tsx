/** Axis labels for a bar chart: first and last only, so they never collide. */
export const Axis = ({ from, to }: { from: string; to: string }) => (
  <div
    className="mono"
    style={{
      display: 'flex',
      justifyContent: 'space-between',
      color: 'var(--faint)',
      fontSize: 10,
      marginTop: 5,
    }}
  >
    <span>{from}</span>
    <span>{to}</span>
  </div>
);
