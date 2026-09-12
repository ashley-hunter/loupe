/** A titled card. The unit every screen's content is grouped into. */
export const Panel = ({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) => (
  <section
    style={{
      border: '1px solid var(--line)',
      borderRadius: 8,
      padding: '13px 15px 15px',
      background: 'var(--panel)',
      marginBottom: 14,
    }}
  >
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, marginBottom: 11 }}>
      <h2 style={{ margin: 0, fontSize: 13, fontWeight: 650, letterSpacing: '-.01em' }}>{title}</h2>
      {note && (
        <span className="mono" style={{ color: 'var(--faint)', fontSize: 11 }}>
          {note}
        </span>
      )}
    </div>
    {children}
  </section>
);
