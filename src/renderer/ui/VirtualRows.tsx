import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useRef } from 'react';

/**
 * A long list that only builds the rows you can see.
 *
 * Measured on the largest Transcript here: 14,361 Events built 75,627 DOM nodes
 * and took about 830ms of the 1.24s it took to open the Session, almost all of
 * it for rows below the fold. Scrolling was never the problem; mounting was.
 */
export function VirtualRows<T>({
  items,
  rowHeight,
  measure = false,
  scrollTo,
  render,
  empty,
}: {
  items: readonly T[];
  /**
   * Row height. Exact for a uniform list like the Timeline's 30px rows; a
   * starting guess when `measure` is set and the rows size themselves.
   */
  rowHeight: number;
  /**
   * Measure each row instead of trusting `rowHeight`. Needed wherever rows
   * differ — a conversation turn is as tall as what was said in it — and worth
   * avoiding otherwise, since it costs a layout read per row.
   */
  measure?: boolean;
  /** Index to keep in view, for selection moved by the keyboard. */
  scrollTo?: number | null;
  render: (item: T, index: number) => React.ReactNode;
  empty?: React.ReactNode;
}) {
  const parent = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parent.current,
    estimateSize: () => rowHeight,
    // A few rows either side, so a fast scroll does not show a blank band.
    overscan: 12,
  });

  // Selection can move by keyboard to a row that was never built, so following
  // it has to go through the virtualizer rather than scrollIntoView.
  useEffect(() => {
    if (scrollTo !== null && scrollTo !== undefined && scrollTo >= 0) {
      virtualizer.scrollToIndex(scrollTo, { align: 'auto' });
    }
  }, [scrollTo, virtualizer]);

  if (items.length === 0 && empty) {
    return (
      <div ref={parent} style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
        {empty}
      </div>
    );
  }

  return (
    <div ref={parent} style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
      {/* Full height so the scrollbar is the real length of the list. */}
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((v) => (
          <div
            key={v.key}
            data-index={v.index}
            ref={measure ? virtualizer.measureElement : undefined}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${String(v.start)}px)`,
            }}
          >
            {render(items[v.index]!, v.index)}
          </div>
        ))}
      </div>
    </div>
  );
}
