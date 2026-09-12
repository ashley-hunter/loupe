/**
 * Nothing to show.
 *
 * `fill` centres it in the whole pane, for a screen with no content at all;
 * without it the message sits at the top, where a list would have started.
 */
export function Empty({
  children,
  fill = false,
  align = 'center',
}: {
  children: React.ReactNode;
  fill?: boolean;
  align?: 'center' | 'left';
}) {
  const text = (
    <div
      style={{
        padding: 40,
        color: 'var(--faint)',
        textAlign: align,
        maxWidth: align === 'left' ? 560 : undefined,
        lineHeight: 1.6,
      }}
    >
      {children}
    </div>
  );

  if (!fill) return text;
  return <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>{text}</div>;
}
