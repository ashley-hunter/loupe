import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoOf } from '../src/main/worktree.js';

const temp = (): Promise<string> => mkdtemp(join(tmpdir(), 'loupe-wt-'));

describe('repoOf', () => {
  it('names a linked worktree after the repository it belongs to', async () => {
    const root = await temp();
    const tree = join(root, 'app-fix-checkout');
    await mkdir(tree);
    // Exactly what git writes into a linked worktree.
    await writeFile(join(tree, '.git'), `gitdir: ${root}/app/.git/worktrees/fix-checkout\n`);
    expect(await repoOf(tree)).toBe('app');
  });

  it('uses the directory name for an ordinary checkout', async () => {
    const root = await temp();
    const repo = join(root, 'app');
    await mkdir(join(repo, '.git'), { recursive: true });
    expect(await repoOf(repo)).toBe('app');
  });

  it('falls back to the directory name when there is no repository', async () => {
    const root = await temp();
    const plain = join(root, 'notes');
    await mkdir(plain);
    expect(await repoOf(plain)).toBe('notes');
  });

  it('falls back when the directory is gone, as a removed worktree would be', async () => {
    // Nothing on disk is left to say what it belonged to, so the name it had is
    // the most honest answer available.
    expect(await repoOf('/definitely/not/here/app-old')).toBe('app-old');
  });
});
