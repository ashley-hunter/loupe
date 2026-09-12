/** Display helpers. A value that cannot be Measured renders as an em dash, never as zero. */

export const BLANK = '—';

export function tokens(n: number | null | undefined): string {
  if (n === null || n === undefined) return BLANK;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(2)}k`;
  return String(Math.round(n));
}

export function percent(fraction: number | null | undefined, digits = 0): string {
  if (fraction === null || fraction === undefined) return BLANK;
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function duration(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}

const DAY = 86_400_000;

export function when(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return BLANK;
  const time = then.toLocaleTimeString(undefined, {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const days = Math.floor((startOfToday.getTime() - then.getTime()) / DAY);

  if (days < 0) return `Today ${time}`;
  if (days < 1) return `Yesterday ${time}`;
  if (days < 6) return `${then.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`;
  return `${then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`;
}

export const clock = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? BLANK
    : d.toLocaleTimeString(undefined, {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
};

/**
 * Shorten a path for display, keeping the end.
 *
 * Paths truncated from the right hide the filename, which is the part worth
 * reading. Anything under `cwd` loses that prefix; anything else keeps its last
 * few segments behind an ellipsis.
 */
export function shortPath(path: string, cwd = '', segments = 3): string {
  // Transcripts record whatever separator the machine uses, so a Windows path
  // arrives as `C:\Users\…`. Splitting on one separator would leave the whole
  // path as a single segment and truncate nothing.
  const underCwd = cwd !== '' && path.startsWith(cwd) && SEPARATOR.test(path.charAt(cwd.length));
  const inProject = underCwd ? path.slice(cwd.length + 1) : path;

  const parts = inProject.split(SEPARATORS).filter(Boolean);
  if (parts.length <= segments) return inProject;
  return '…/' + parts.slice(-segments).join('/');
}

/** Either separator, since a Transcript may have been written on any platform. */
const SEPARATORS = /[\\/]/;
const SEPARATOR = /^[\\/]$/;

/** The last segment of a path, whichever separator it uses. */
export const fileName = (path: string): string => path.split(SEPARATORS).pop() ?? path;

/**
 * A shell command with its leading directory change dropped.
 *
 * `cd /long/path && npm test` reads as `npm test` when scanning a list — the
 * directory is already shown as the project. The Timeline keeps commands
 * verbatim, because there the point is what exactly ran.
 */
export function command(text: string): string {
  const stripped = text.replace(/^cd\s+(?:'[^']*'|"[^"]*"|\S+)\s*(?:&&\s*)?/, '');
  return stripped.trim() === '' ? text : stripped;
}

/** Strips the vendor prefix and date suffix: `claude-opus-5` -> `Opus 5`. */
export function model(id: string): string {
  const m = /^claude-([a-z]+)-([\d-]+)/.exec(id);
  if (!m) return id;
  const [, family, version] = m;
  const name = (family ?? '').replace(/^./, (c) => c.toUpperCase());
  return `${name} ${(version ?? '').replace(/-\d{8}$/, '').replace(/-/g, '.')}`;
}
