import { execFile, spawn } from 'node:child_process';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ActionKind, RunRecord } from '../shared/tools.js';

/**
 * Running Claude Code on your behalf.
 *
 * This is the only part of Loupe that writes anything. Everywhere else reads
 * Transcripts and reports; here a Session gains a turn, or its context is
 * replaced, or a file appears in a repository. That asymmetry is why every run
 * is recorded with what it was, whether it worked, and what the command itself
 * said - a thing that acts unattended has to leave a trail you can audit.
 *
 * The mechanism is `claude --resume <id> -p`, which continues the Session under
 * its own id and so re-reads the very prefix being kept alive. It cannot reach
 * into the terminal you are typing in; if that Session is mid-Request, Claude
 * Code starts a copy instead, which is why nothing fires unless the Session has
 * been idle.
 */

/** Moves with `LOUPE_ROOT`, like the Alert log, so a demo run records nowhere real. */
const LOG_PATH = process.env['LOUPE_ROOT']
  ? join(process.env['LOUPE_ROOT'], '.loupe-runs.jsonl')
  : join(homedir(), '.claude', '.loupe-runs.jsonl');

const KEEP = 200;

/**
 * The cheapest turn that still reads the whole prefix.
 *
 * It has to be a real Request - that is the entire point, the cache is kept by
 * being read - so the aim is the smallest one, not no one at all.
 */
const KEEP_ALIVE_PROMPT = 'Reply with the single word: ok. Do not use any tools.';

const HANDOFF_PROMPT =
  'Write a handoff document to HANDOFF.md: what we were doing, what is finished, ' +
  'what is left, the files that matter and why, and anything a fresh session ' +
  'would get wrong without being told. Write only that file, then stop.';

/** How long each kind is given before it is killed. Compaction is the slow one. */
const TIMEOUT_MS: Record<ActionKind | 'wake-up', number> = {
  'keep-alive': 60_000,
  compact: 240_000,
  handoff: 240_000,
  'wake-up': 120_000,
};

/**
 * Where `claude` actually is.
 *
 * A packaged app is launched by launchd and inherits its PATH, not the shell's,
 * so `~/.local/bin` and every version manager's shim are missing. Asking the
 * login shell is one call and is right for all of them; guessing at install
 * locations is several and is right for some.
 */
let resolved: string | null | undefined;

export async function claudeBin(): Promise<string | null> {
  if (resolved !== undefined) return resolved;
  const shell = process.env['SHELL'] ?? '/bin/zsh';
  resolved = await new Promise<string | null>((done) => {
    execFile(shell, ['-lc', 'command -v claude'], { timeout: 8000 }, (error, stdout) => {
      if (error) {
        done(null);
        return;
      }
      const line = stdout.trim().split('\n').at(-1)?.trim() ?? '';
      done(line === '' ? null : line);
    });
  });
  return resolved;
}

/**
 * Arguments for each kind. The prompt goes in on stdin rather than as an
 * argument, so nothing has to reason about where a variadic option stops.
 */
function argsFor(kind: ActionKind, sessionId: string): string[] {
  const resume = ['--resume', sessionId, '-p'];
  switch (kind) {
    // Two rails rather than one: the prompt asks for no tools, and the ones
    // that could change something are refused outright.
    case 'keep-alive':
      return [...resume, '--disallowedTools', 'Bash', 'Edit', 'Write', 'Task'];
    case 'compact':
      return resume;
    // Only Write is pre-approved. Under `-p` anything else that would prompt is
    // denied, so this cannot quietly turn into a session that edits the repo.
    case 'handoff':
      return [...resume, '--allowedTools', 'Write'];
  }
}

const promptFor = (kind: ActionKind): string =>
  kind === 'keep-alive' ? KEEP_ALIVE_PROMPT : kind === 'compact' ? '/compact' : HANDOFF_PROMPT;

interface Outcome {
  ok: boolean;
  detail: string;
}

interface Invocation {
  bin: string;
  args: string[];
  prompt: string;
  cwd: string;
  timeoutMs: number;
}

/** Run `claude` to completion, feeding it a prompt and keeping its last words. */
function run({ bin, args, prompt, cwd, timeoutMs }: Invocation): Promise<Outcome> {
  return new Promise<Outcome>((done) => {
    const child = spawn(bin, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      // Detached would outlive a quit; this should not.
      env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: 'loupe' },
    });

    let out = '';
    let err = '';
    // Only the tail is kept: a compaction prints a summary, and holding all of
    // it to show one line in a log would be the waste this app exists to find.
    const take = (chunk: string, into: 'out' | 'err'): void => {
      if (into === 'out') out = (out + chunk).slice(-2000);
      else err = (err + chunk).slice(-2000);
    };

    child.stdout.on('data', (d: Buffer) => {
      take(d.toString(), 'out');
    });
    child.stderr.on('data', (d: Buffer) => {
      take(d.toString(), 'err');
    });

    const killer = setTimeout(() => {
      child.kill('SIGTERM');
    }, timeoutMs);

    child.on('error', (e) => {
      clearTimeout(killer);
      done({ ok: false, detail: e.message });
    });

    child.on('close', (code) => {
      clearTimeout(killer);
      const said = (out.trim() || err.trim()).split('\n').slice(-3).join(' ').slice(0, 300);
      done({
        ok: code === 0,
        detail: said || (code === 0 ? 'Completed' : `Exited ${String(code)}`),
      });
    });

    // `claude` can exit before it reads the prompt - a stale --resume id, an
    // auth failure, a flag an older build does not know. Writing to the closed
    // pipe then raises EPIPE on the stream, and an unhandled 'error' on a
    // stream is an uncaught exception that takes the whole app with it. The
    // close handler above already reports what happened.
    child.stdin.on('error', () => undefined);
    child.stdin.end(prompt);
  });
}

const missing: Outcome = {
  ok: false,
  detail: 'Could not find the claude command on your login shell PATH',
};

/** Run an action against a Session. */
export async function runAction(
  kind: ActionKind,
  session: { id: string; cwd: string; name: string; project: string },
  prefix?: number,
): Promise<RunRecord> {
  const bin = await claudeBin();
  const outcome = bin
    ? await run({
        bin,
        args: argsFor(kind, session.id),
        prompt: promptFor(kind),
        cwd: session.cwd,
        timeoutMs: TIMEOUT_MS[kind],
      })
    : missing;

  return record({
    id: `${kind}:${session.id}:${String(Date.now())}`,
    at: new Date().toISOString(),
    kind,
    label: session.name,
    project: session.project,
    ...outcome,
    ...(prefix === undefined ? {} : { prefix }),
  });
}

/** Start a Session from nothing, which is what puts the Block boundary here. */
export async function runWakeUp(wake: {
  id: string;
  cwd: string;
  prompt: string;
}): Promise<RunRecord> {
  const bin = await claudeBin();
  const outcome = bin
    ? await run({
        bin,
        args: ['-p', '--disallowedTools', 'Bash', 'Edit', 'Write', 'Task'],
        prompt: wake.prompt,
        cwd: wake.cwd,
        timeoutMs: TIMEOUT_MS['wake-up'],
      })
    : missing;

  return record({
    id: `wake:${wake.id}:${String(Date.now())}`,
    at: new Date().toISOString(),
    kind: 'wake-up',
    label: wake.prompt.slice(0, 60),
    project: wake.cwd.split('/').at(-1) ?? wake.cwd,
    ...outcome,
  });
}

/** Note something that was decided against, so the log explains its own gaps. */
export const noteSkipped = (
  kind: ActionKind | 'wake-up',
  label: string,
  project: string,
  detail: string,
): Promise<RunRecord> =>
  record({
    id: `skip:${kind}:${String(Date.now())}`,
    at: new Date().toISOString(),
    kind,
    label,
    project,
    ok: false,
    detail,
  });

async function record(entry: RunRecord): Promise<RunRecord> {
  await appendFile(LOG_PATH, JSON.stringify(entry) + '\n').catch(() => undefined);
  // Trimmed on write, unlike the Alert log. With auto-actions on, this gains an
  // entry every few minutes for as long as the app runs, and `seedFired` reads
  // the whole of it on every start. A run happens minutes apart at most, so
  // rewriting a two-hundred-line file when it overflows costs nothing.
  await trim();
  return entry;
}

/** Keep the newest KEEP entries, when there are more than that. */
async function trim(): Promise<void> {
  const raw = await readFile(LOG_PATH, 'utf8').catch(() => '');
  const lines = raw.split('\n').filter(Boolean);
  if (lines.length <= KEEP * 2) return;
  await writeFile(LOG_PATH, lines.slice(-KEEP).join('\n') + '\n').catch(() => undefined);
}

/** Everything run, newest first. */
export async function readRuns(): Promise<RunRecord[]> {
  const raw = await readFile(LOG_PATH, 'utf8').catch(() => '');
  const out: RunRecord[] = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as RunRecord);
    } catch {
      /* skip a torn line */
    }
  }
  return out.reverse().slice(0, KEEP);
}
