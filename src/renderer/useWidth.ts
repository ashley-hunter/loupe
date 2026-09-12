import { useEffect, useState } from 'react';

/**
 * Window width, for the design's layout breakpoints (700 / 920 / 1180).
 *
 * The design drops table columns and collapses the sidebar to a rail at these
 * widths, so the component tree needs the number rather than CSS alone.
 */
export function useWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth);

  useEffect(() => {
    const onResize = (): void => {
      setWidth(window.innerWidth);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return width;
}
