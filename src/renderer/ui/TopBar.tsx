import { Badge } from './Badge.js';

/**
 * The bar at the top of a screen.
 *
 * Also the window's drag handle, so dragging empty space moves the window as it
 * would in any native app.
 */
export function TopBar({
  title,
  count,
  note,
  children,
}: {
  title: string;
  count?: number | undefined;
  /** Secondary text beside the title, in the mono face. */
  note?: string | undefined;
  /** Controls belonging to this screen: filters, a search box, an action. */
  children?: React.ReactNode;
}) {
  return (
    <div className="topbar drag-region">
      <span style={{ fontWeight: 600, letterSpacing: '-.01em', flex: 'none' }}>{title}</span>
      {count !== undefined && <Badge>{count}</Badge>}
      {note !== undefined && (
        <span className="mono" style={{ color: 'var(--faint)', fontSize: 11, flex: 'none' }}>
          {note}
        </span>
      )}
      {children}
    </div>
  );
}
