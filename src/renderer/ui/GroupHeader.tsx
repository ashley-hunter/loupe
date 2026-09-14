import { ChevronDown, ChevronRight } from 'lucide-react';
import { ICON } from '../App.js';

/**
 * The band that starts a group in a long list.
 *
 * Carries its own subtotals: a group you can only count by eye is a heading,
 * not an answer to where the work went.
 */
export function GroupHeader({
  name,
  meta,
  collapsed,
  onToggle,
}: {
  name: string;
  /** Subtotals for the group, already formatted. */
  meta: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const Chevron = collapsed ? ChevronRight : ChevronDown;

  return (
    <button className="group-header" onClick={onToggle} aria-expanded={!collapsed}>
      <Chevron {...ICON} style={{ flex: 'none', color: 'var(--faint)' }} aria-hidden />
      <span className="ellipsis" style={{ fontWeight: 600, fontSize: 12 }}>
        {name}
      </span>
      <span className="mono" style={{ marginLeft: 'auto', color: 'var(--faint)', fontSize: 11 }}>
        {meta}
      </span>
    </button>
  );
}
