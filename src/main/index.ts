import { app, BrowserWindow, ipcMain, Notification, shell } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildAdvice,
  buildCacheReport,
  buildFindings,
  buildIndex,
  buildProjects,
  buildStartup,
  buildThreshold,
  loadSession,
  runSearch,
} from './catalogue.js';
import { detectAlerts } from './alerts.js';
import { readAlerts, recordAlerts } from './alert-log.js';
import { watchLive } from './live.js';
import { readSamples, readUsage, startPolling, type Poller } from './usage.js';
import type { SessionDetail } from '../shared/model.js';
import { checkForUpdates, installUpdate, startUpdates, updateState } from './updates.js';
import { startScheduler, type Scheduler } from './scheduler.js';
import { readRuns } from './runner.js';
import type { ActionKind, CacheClock, ToolsConfig } from '../shared/tools.js';

const here = dirname(fileURLToPath(import.meta.url));
const DEV_URL = process.env['VITE_DEV_SERVER_URL'];

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 680,
    minHeight: 480,
    // Native macOS traffic lights sitting inside our own top bar.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 13, y: 13 },
    backgroundColor: '#faf9f8',
    // Avoids the white flash before the renderer paints.
    show: false,
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  // Development only: never present in a packaged build.
  if (!app.isPackaged && process.env['SHOT_OUT']) void capture(win);

  // Links open in the real browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  void (DEV_URL ? win.loadURL(DEV_URL) : win.loadFile(join(here, '../renderer/index.html')));
}

/** Click the nth element matching SHOT_CLICK, as `selector#index`. */
async function runClick(win: BrowserWindow): Promise<void> {
  const spec = process.env['SHOT_CLICK'];
  if (!spec) return;
  const [sel, nth] = spec.split('#');
  const clicked = (await win.webContents.executeJavaScript(`
    (() => {
      const all = [...document.querySelectorAll(${JSON.stringify(sel)})];
      const el = all[${JSON.stringify(Number(nth ?? 0))}];
      if (!el) return 'NOT FOUND: ' + ${JSON.stringify(sel)} + ' (' + all.length + ' present)';
      el.click();
      return 'clicked ' + ${JSON.stringify(sel)};
    })()
  `)) as string;
  console.log('[shot]', clicked);
  await new Promise((r) => setTimeout(r, 900));
}

/**
 * Evaluate SHOT_PROBE in the page and log what it returns.
 *
 * How the rendering costs here get measured: DOM node counts, the time to open
 * a Session, heap size. Numbers beat looking at a screenshot and guessing.
 */
async function runProbe(win: BrowserWindow): Promise<void> {
  const source = process.env['SHOT_PROBE'];
  if (!source) return;
  const result = (await win.webContents.executeJavaScript(source)) as unknown;
  console.log('[probe]', JSON.stringify(result));
}

/**
 * Render the window to a PNG and exit. Set SHOT_OUT (and optionally SHOT_SCREEN
 * / SHOT_THEME) to use it.
 *
 * This exists because `screencapture` returns black when the display sleeps,
 * which makes it useless for checking the UI from a long-running session.
 * capturePage renders offscreen and does not care.
 */
async function capture(win: BrowserWindow): Promise<void> {
  const { writeFileSync } = await import('node:fs');
  try {
    await new Promise((r) => setTimeout(r, 5000));
    const screen = process.env['SHOT_SCREEN'] ?? 'sessions';
    const theme = process.env['SHOT_THEME'] ?? 'light';
    const result = (await win.webContents.executeJavaScript(`
      document.documentElement.dataset.theme = ${JSON.stringify(theme)};
      (() => {
        const want = ${JSON.stringify(screen)};
        if (want === 'sessions') return 'sessions';
        if (want.startsWith('tab:')) {
          const match = ${JSON.stringify(process.env['SHOT_SESSION'] ?? '')};
          const rows = [...document.querySelectorAll('.crow')];
          const row = match ? rows.find(r => r.textContent.includes(match)) : rows[0];
          if (row) { row.click(); return 'row clicked'; }
          return 'ROW NOT FOUND: ' + match;
        }
        if (want === 'detail') {
          const row = document.querySelector('.crow');
          if (row) { row.click(); return 'opened first session'; }
          return 'NO ROWS';
        }
        const b = [...document.querySelectorAll('nav button')]
          .find(x => (x.getAttribute('title') || '').toLowerCase().startsWith(want));
        if (b) { b.click(); return 'clicked ' + want; }
        return 'NOT FOUND: ' + want;
      })()
    `)) as string;
    console.log('[shot] nav:', result);
    await new Promise((r) => setTimeout(r, 6000));
    if (process.env['SHOT_QUERY']) {
      await win.webContents.executeJavaScript(`
        (() => {
          const box = document.querySelector('input[placeholder^="Find"]');
          if (!box) return 'NO SEARCH BOX';
          const set = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value').set;
          set.call(box, ${JSON.stringify(process.env['SHOT_QUERY'])});
          box.dispatchEvent(new Event('input', { bubbles: true }));
          return 'typed';
        })()
      `);
      await new Promise((r) => setTimeout(r, 4000));
    }
    if (screen.startsWith('tab:')) {
      const tab = screen.slice(4);
      const picked = (await win.webContents.executeJavaScript(`
        (() => {
          const t = [...document.querySelectorAll('.tab')]
            .find(x => x.textContent.trim().toLowerCase().startsWith(${JSON.stringify(tab)}));
          if (t) { t.click(); return 'tab ' + ${JSON.stringify(tab)}; }
          return 'TAB NOT FOUND: ' + ${JSON.stringify(tab)};
        })()
      `)) as string;
      console.log('[shot]', picked);
      await new Promise((r) => setTimeout(r, 2500));
    }
    if (process.env['SHOT_PALETTE']) {
      const opened = (await win.webContents.executeJavaScript(`
        (() => {
          document.dispatchEvent(new KeyboardEvent('keydown', {}));
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
          return 'sent cmd-k';
        })()
      `)) as string;
      console.log('[shot]', opened);
      await new Promise((r) => setTimeout(r, 800));
      const typed = (await win.webContents.executeJavaScript(`
        (() => {
          const box = document.querySelector('input[placeholder^="Go to"]');
          if (!box) return 'NO PALETTE';
          const set = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value').set;
          set.call(box, ${JSON.stringify(process.env['SHOT_PALETTE'])});
          box.dispatchEvent(new Event('input', { bubbles: true }));
          return 'typed';
        })()
      `)) as string;
      console.log('[shot]', typed);
      await new Promise((r) => setTimeout(r, 3500));
    }
    await runClick(win);
    if (process.env['SHOT_SCROLL'] === 'bottom') {
      await win.webContents.executeJavaScript(`
        (() => {
          const pane = document.querySelector('.scroll-pane')
            || [...document.querySelectorAll('div')].find(d => d.scrollHeight > d.clientHeight + 50);
          if (pane) pane.scrollTop = pane.scrollHeight;
          return pane ? 'scrolled' : 'no pane';
        })()
      `);
      await new Promise((r) => setTimeout(r, 900));
    }
    if (process.env['SHOT_HOVER']) {
      // A real pointer move, so :hover actually engages rather than being faked
      // with a class that only proves the declarations exist.
      const [hx, hy] = process.env['SHOT_HOVER'].split(',').map(Number);
      win.webContents.sendInputEvent({ type: 'mouseMove', x: hx ?? 0, y: hy ?? 0 });
      await new Promise((r) => setTimeout(r, 700));
    }
    await runProbe(win);
    const img = await win.webContents.capturePage();
    writeFileSync(process.env['SHOT_OUT']!, img.toPNG());
    console.log('[shot] wrote', process.env['SHOT_OUT']);
  } catch (e) {
    console.error('[shot] FAILED', e);
  }
  app.quit();
}

ipcMain.handle('loupe:index', () => buildIndex());
ipcMain.handle('loupe:startup', () => buildStartup());
ipcMain.handle('loupe:threshold', () => buildThreshold());
ipcMain.handle('loupe:cache', () => buildCacheReport());
ipcMain.handle('loupe:findings', () => buildFindings());
ipcMain.handle('loupe:advice', () => buildAdvice());
ipcMain.handle('loupe:projects', () => buildProjects());
ipcMain.handle('loupe:search', (_e, query: string, kind: string) =>
  runSearch(query, kind as Parameters<typeof runSearch>[1]),
);

/**
 * The live watcher runs for as long as the app does, not just while the Live
 * screen is open.
 *
 * It used to start and stop with that screen, which meant an Alert could only
 * be raised while you were already watching the thing it would have told you
 * about. A notification you can only receive when you do not need it is not a
 * notification.
 */
let stopLive: (() => void) | null = null;

/** The only part of the app that writes anything. Off until it is configured. */
let scheduler: Scheduler | null = null;

/**
 * The last expiry announced per Session, so a countdown crossing the warning
 * line once does not announce itself on every re-parse of the same idle
 * Session - and so two Sessions expiring together each get their own warning.
 */
const warnedExpiry = new Map<string, string>();

/** The most recent reading, so a Live screen opening mid-session is not blank. */
let latestLive: SessionDetail | null = null;

/**
 * Ids already alerted on. The live Session is re-parsed on every write, so
 * without this the same expensive read would be announced again each time.
 * Seeded from the log, because a Session outlives a single app run.
 */
const alerted = new Set<string>();

const broadcast = (channel: string, payload: unknown): void => {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.webContents.isDestroyed()) w.webContents.send(channel, payload);
  }
};

/**
 * How long before expiry to say something.
 *
 * Far enough ahead to be able to act, close enough that the Session really has
 * been left alone. On a five-minute prefix this means four minutes of silence
 * have already passed.
 */
const EXPIRY_LEAD_MS = 60_000;

/** Nothing smaller than this is worth interrupting anyone about. */
const EXPIRY_FLOOR = 50_000;

/**
 * Warn that the cached prefix is about to go.
 *
 * The one notification in the app that arrives *before* the cost rather than
 * after it, which is the only reason it is allowed to interrupt: an Alert can
 * tell you what you spent, this can still change it.
 *
 * It stays quiet for a Session that was already winding down. A long typical
 * gap means the expiry is what happens when you stop working, and announcing
 * that would be announcing the end of every session you ever finish.
 */
function warnExpiry(clock: CacheClock): void {
  if (clock.prefix < EXPIRY_FLOOR) return;
  if (clock.msLeft <= 0 || clock.msLeft > EXPIRY_LEAD_MS) return;
  if (clock.typicalGapMs > EXPIRY_LEAD_MS * 3) return;
  if (warnedExpiry.get(clock.sessionId) === clock.expiresAt) return;

  // Marked only once something was actually shown. Recording it first meant a
  // countdown that happened to cross the line while the window was focused was
  // marked announced forever, so looking away a moment later got nothing.
  const [window] = BrowserWindow.getAllWindows();
  if (window?.isFocused() === true || !Notification.isSupported()) return;
  warnedExpiry.set(clock.sessionId, clock.expiresAt);

  const held = format(clock.prefix);
  const worth = Math.round(clock.breakEvenMs / 60_000);

  const note = new Notification({
    title: `${held} of cached context expires in under a minute`,
    // The break-even, not just the deadline: the decision is whether to hold
    // it, and that depends on when you are coming back.
    body:
      `${clock.sessionName}\n${clock.project} · worth keeping alive if you are back ` +
      `within ${String(worth)} min, otherwise let it go`,
  });
  note.on('click', () => {
    const [w] = BrowserWindow.getAllWindows();
    if (!w) return;
    if (w.isMinimized()) w.restore();
    w.focus();
    w.webContents.send('loupe:open-tools');
  });
  note.show();
}

const format = (n: number): string =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(2)}M`
    : n >= 1000
      ? `${(n / 1000).toFixed(0)}k`
      : String(n);

function beginWatchingLive(): void {
  stopLive?.();
  stopLive = watchLive((running) => {
    // Live still follows one Session - the one being typed in, which is the
    // most recently written. Everything else here works from the whole set.
    latestLive = running[0] ?? null;
    broadcast('loupe:live', latestLive);

    // The scheduler sees the Sessions before anything else does: its whole job
    // is to act before a deadline, and a tick's delay is sometimes the
    // difference between acting and reporting.
    scheduler?.observe(running);
    const clocks = scheduler?.clocks() ?? [];
    broadcast('loupe:cache-clock', clocks);
    for (const clock of clocks) warnExpiry(clock);

    // A Session that has stopped running keeps nothing here.
    const live = new Set(clocks.map((c) => c.sessionId));
    for (const id of warnedExpiry.keys()) if (!live.has(id)) warnedExpiry.delete(id);

    const fresh = running.flatMap((detail) => detectAlerts(detail, alerted));
    for (const alert of fresh) alerted.add(alert.id);
    if (fresh.length === 0) return;

    void recordAlerts(fresh);
    broadcast('loupe:alerts', fresh);

    // A native notification only when the app is not already in front of you;
    // the renderer shows a banner otherwise.
    const [window] = BrowserWindow.getAllWindows();
    if (window?.isFocused() === true || !Notification.isSupported()) return;
    for (const alert of fresh.slice(0, 2)) {
      const note = new Notification({
        title: alert.title,
        // Which Session, not just which project: a project can have several
        // running at once, and the Session name is the prompt you recognise.
        body: `${alert.sessionName}\n${alert.project} · ${alert.detail}`,
      });
      // Clicking it should land on the evidence, not merely raise the window.
      note.on('click', () => {
        const [w] = BrowserWindow.getAllWindows();
        if (!w) return;
        if (w.isMinimized()) w.restore();
        w.focus();
        w.webContents.send('loupe:open-alert', alert);
      });
      note.show();
    }
  });
}

/** Hand the current reading straight to a Live screen that has just mounted. */
ipcMain.handle('loupe:live-start', (event) => {
  if (!event.sender.isDestroyed()) event.sender.send('loupe:live', latestLive);
});

/**
 * Nothing to stop any more: the watcher is owned by the app, not the screen.
 * Kept so an older renderer bundle calling it is not an error.
 */
ipcMain.handle('loupe:live-stop', () => undefined);

ipcMain.handle('loupe:alert-history', () => readAlerts());

ipcMain.handle('loupe:cache-clock', () => scheduler?.clocks() ?? []);
ipcMain.handle('loupe:tools-config', () => scheduler?.config() ?? { wakeUps: [], actions: [] });
ipcMain.handle('loupe:tools-config-set', (_e, config: ToolsConfig) => scheduler?.setConfig(config));
ipcMain.handle(
  'loupe:run-action',
  (_e, kind: ActionKind, sessionId: string) => scheduler?.runNow(kind, sessionId) ?? null,
);
ipcMain.handle('loupe:runs', () => readRuns());
/**
 * The current Allowance, or the most recent recorded reading when the endpoint
 * is unreachable. A recorded sample carries its own timestamp, so the UI can say
 * how old it is — that is still Measured, unlike a guess.
 */
ipcMain.handle('loupe:usage', async () => {
  const live = await readUsage();
  if (live.status === 'ok') return live.sample;
  return (await readSamples()).at(-1) ?? null;
});
ipcMain.handle('loupe:session', (_e, path: string) => loadSession(path));
ipcMain.handle('loupe:reveal', (_e, path: string) => {
  shell.showItemInFolder(path);
});

ipcMain.handle('loupe:update-state', () => updateState());
ipcMain.handle('loupe:update-check', () => {
  checkForUpdates();
});
ipcMain.handle('loupe:update-install', () => {
  installUpdate();
});

let poller: Poller | null = null;
let stopUpdates: (() => void) | null = null;

/**
 * One instance only.
 *
 * A second would start its own poller against an endpoint that rate-limits, and
 * both would append to the same samples file — the one piece of data here that
 * cannot be reconstructed. Launching again focuses the window that exists.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [existing] = BrowserWindow.getAllWindows();
    if (!existing) return;
    if (existing.isMinimized()) existing.restore();
    existing.focus();
  });
}

void app.whenReady().then(() => {
  createWindow();

  // Reads consumption without running inference: no tokens, no allowance.
  // Alerts already raised in an earlier run must not be announced again.
  void readAlerts().then((past) => {
    for (const a of past) alerted.add(a.id);
    beginWatchingLive();
  });

  scheduler = startScheduler((record) => {
    broadcast('loupe:run', record);
  });

  poller = startPolling((sample) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('loupe:usage-sample', sample);
  });
  stopUpdates = startUpdates();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('loupe:poll-interval', (_e, minutes: number) => {
  poller?.setInterval(minutes * 60_000);
});

app.on('before-quit', () => {
  poller?.stop();
  stopLive?.();
  stopUpdates?.();
  scheduler?.stop();
});
