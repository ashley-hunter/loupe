/** A row of figures, wrapping, on the panel colour. */
export const StatStrip = ({ children }: { children: React.ReactNode }) => (
  <div
    style={{
      flex: 'none',
      display: 'flex',
      gap: 26,
      padding: '12px 16px',
      flexWrap: 'wrap',
      borderBottom: '1px solid var(--line)',
      background: 'var(--panel)',
    }}
  >
    {children}
  </div>
);
