import { app, BrowserWindow } from 'electron';
import electronUpdater from 'electron-updater';

// electron-updater ships CommonJS, so the named export is not reachable from an
// ES module without going through the default.
const { autoUpdater } = electronUpdater;

/**
 * How often to ask GitHub.
 *
 * This is a metadata read against the releases API, not the Anthropic endpoint,
 * so it costs nothing and no Allowance (ADR-0002). Six hours is far more often
 * than releases actually appear; the point is that a long-running window picks
 * one up without being restarted.
 */
const CHECK_INTERVAL_MS = 6 * 60 * 60_000;

/**
 * Long enough for the launch parse to finish first. A check is cheap, but
 * `autoDownload` means a hit starts pulling a hundred megabytes, and doing that
 * while the Transcripts are still being read makes the first paint slower for
 * no reason.
 */
const FIRST_CHECK_DELAY_MS = 15_000;

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'failed'; message: string };

export interface UpdateState {
  /** The running version, so Settings has something to show when nothing is happening. */
  version: string;
  /** False in development and for a Linux package a distribution manages. */
  supported: boolean;
  status: UpdateStatus;
}

let status: UpdateStatus = { state: 'idle' };
let pending = '';

function broadcast(next: UpdateStatus): void {
  status = next;
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('loupe:update', next);
}

export const updateState = (): UpdateState => ({
  version: app.getVersion(),
  supported: app.isPackaged,
  status,
});

export function checkForUpdates(): void {
  if (!app.isPackaged) return;
  // The promise rejects for the same reasons the 'error' event fires, which
  // already reports them; this catch only stops the rejection being unhandled.
  void autoUpdater.checkForUpdates().catch(() => undefined);
}

/** Swap in the downloaded version. Quits, so it only runs on an explicit click. */
export function installUpdate(): void {
  if (status.state !== 'ready') return;
  autoUpdater.quitAndInstall();
}

/**
 * Follow GitHub releases (ADR-0004).
 *
 * Nothing happens in development: an unpackaged run has no version to compare
 * and no signature to validate, and the updater throws rather than no-ops.
 */
export function startUpdates(): () => void {
  if (!app.isPackaged) return () => undefined;

  autoUpdater.autoDownload = true;
  // A download that finished after the window closed should still be installed
  // rather than fetched again next time.
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    broadcast({ state: 'checking' });
  });
  autoUpdater.on('update-not-available', () => {
    broadcast({ state: 'idle' });
  });
  autoUpdater.on('update-available', (info) => {
    pending = info.version;
    broadcast({ state: 'downloading', version: info.version, percent: 0 });
  });
  autoUpdater.on('download-progress', (p) => {
    broadcast({ state: 'downloading', version: pending, percent: Math.round(p.percent) });
  });
  autoUpdater.on('update-downloaded', (info) => {
    broadcast({ state: 'ready', version: info.version });
  });
  // Most often no network, or macOS refusing an unsigned build. Settings offers
  // the releases page instead, because a failure here is not the user's problem
  // to diagnose.
  autoUpdater.on('error', (e: Error) => {
    broadcast({ state: 'failed', message: e.message });
  });

  const first = setTimeout(checkForUpdates, FIRST_CHECK_DELAY_MS);
  const repeat = setInterval(checkForUpdates, CHECK_INTERVAL_MS);
  return () => {
    clearTimeout(first);
    clearInterval(repeat);
  };
}
