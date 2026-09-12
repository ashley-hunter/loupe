/** A small count beside a title: `Sessions 23`, `Cache 195`. */
export const Badge = ({ children }: { children: React.ReactNode }) => (
  <span
    className="mono"
    style={{
      fontSize: 10,
      padding: '1px 5px',
      border: '1px solid var(--line)',
      borderRadius: 3,
      color: 'var(--dim)',
      flex: 'none',
    }}
  >
    {children}
  </span>
);
