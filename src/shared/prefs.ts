/** Preferences that genuinely vary. Everything else is a defensible default. */
export interface Prefs {
  /** Tool output larger than this stays collapsed. 0 means never collapse. */
  collapseAbove: number;
  /** Minutes between Allowance polls. Below five risks a 429. */
  pollMinutes: number;
}

export const DEFAULT_PREFS: Prefs = {
  collapseAbove: 2000,
  pollMinutes: 5,
};

/** Shown in Settings; the real path is resolved in the main process. */
export const TRANSCRIPT_ROOT_LABEL = '~/.claude/projects';
