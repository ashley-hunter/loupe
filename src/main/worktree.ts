import { readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

/**
 * The repository a working directory belongs to.
 *
 * Git worktrees give one repository several working directories, each with its
 * own name: a session run in `app-fix-checkout` and one run in `app` are the
 * same codebase, and grouping them apart answers the question wrongly.
 *
 * A linked worktree's `.git` is a file rather than a directory, holding a line
 * of the form `gitdir: /path/to/app/.git/worktrees/fix-checkout`. Everything
 * before `/.git/` is the real repository, so this needs no git binary and no
 * subprocess — just one small read per distinct directory.
 */
const GITDIR = /^gitdir:\s*(.+)$/m;

/** Resolved names, keyed by cwd. A directory's repository does not change. */
const cache = new Map<string, string>();

export async function repoOf(cwd: string): Promise<string> {
  if (cwd === '') return '';
  const known = cache.get(cwd);
  if (known !== undefined) return known;

  const name = await resolve(cwd);
  cache.set(cwd, name);
  return name;
}

async function resolve(cwd: string): Promise<string> {
  const fallback = basename(cwd);
  const dotGit = join(cwd, '.git');

  const info = await stat(dotGit).catch(() => null);
  // No .git at all, or a directory that no longer exists: this is the best name
  // available. A worktree that has since been removed lands here, and there is
  // nothing left on disk to say what it belonged to.
  if (!info) return fallback;
  if (info.isDirectory()) return fallback;

  const raw = await readFile(dotGit, 'utf8').catch(() => '');
  const match = GITDIR.exec(raw);
  if (!match?.[1]) return fallback;

  const [main] = match[1].trim().split('/.git/worktrees/');
  return main !== undefined && main !== '' ? basename(main) : fallback;
}
