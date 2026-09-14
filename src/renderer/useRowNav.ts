import { useRef } from 'react';

/**
 * Arrow-key movement through a list of rows, and Enter to open one.
 *
 * The rows here are divs with an onClick, which means a pointer is the only way
 * to reach them: not just inconvenient but unreachable by keyboard or screen
 * reader. `rowProps` makes a row a real control; `onKeyDown` on the container
 * moves focus between them.
 */
export function useRowNav<T extends HTMLElement = HTMLDivElement>(): [
  React.RefObject<T | null>,
  (e: React.KeyboardEvent) => void,
] {
  const ref = useRef<T>(null);

  const move = (e: React.KeyboardEvent): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const found = ref.current?.querySelectorAll<HTMLElement>('[data-row]');
    const rows = found ? Array.from(found) : [];
    if (rows.length === 0) return;

    e.preventDefault();
    const at = rows.indexOf(document.activeElement as HTMLElement);
    // From nowhere, ArrowDown starts at the top rather than doing nothing.
    const next =
      at === -1
        ? 0
        : e.key === 'ArrowDown'
          ? Math.min(rows.length - 1, at + 1)
          : Math.max(0, at - 1);
    rows[next]?.focus();
  };

  // A tuple, so the call site destructures rather than reading `.ref` in render.
  return [ref, move];
}

/** What a row needs to behave like the control it already looked like. */
export const rowProps = (
  onOpen: () => void,
): {
  'data-row': true;
  tabIndex: number;
  role: 'button';
  onClick: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
} => ({
  'data-row': true,
  tabIndex: 0,
  role: 'button',
  onClick: onOpen,
  onKeyDown: (e) => {
    // Space scrolls by default; a row that opens on Space must say otherwise.
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    onOpen();
  },
});
