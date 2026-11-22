import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { removeMergedWorktree } from './merged-worktree';

setupRitewayBun();

function repository() {
  const root = mkdtempSync(join(tmpdir(), 'merged-worktree-'));
  const cwd = join(root, 'repo');
  const path = join(root, 'slice');
  mkdirSync(cwd);
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.test');
  git('config', 'user.name', 'test');
  writeFileSync(
    join(cwd, '.gitignore'),
    'node_modules/\n.env\nnotes.private\n',
  );
  git('add', '.gitignore');
  git('commit', '-qm', 'base');
  git('worktree', 'add', '-qb', 'pu/slice', path);
  writeFileSync(join(path, 'source.txt'), 'delivered');
  git('-C', path, 'add', 'source.txt');
  git('-C', path, 'commit', '-qm', 'slice');
  const head = git('-C', path, 'rev-parse', 'HEAD');
  git('merge', '-q', '--no-ff', '-m', 'merge', 'pu/slice');
  const pr = {
    state: 'MERGED',
    branch: 'pu/slice',
    head,
    merge: git('rev-parse', 'HEAD'),
  };
  const worktree = { id: 'wt-slice', path, branch: 'pu/slice' };
  const retired: string[] = [];
  const remove = () =>
    removeMergedWorktree(cwd, pr, worktree, (id) => {
      if (existsSync(path)) throw new Error('retired before safe Git removal');
      retired.push(id);
    });
  return {
    root,
    cwd,
    path,
    git,
    pr,
    worktree,
    retired,
    remove,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

describe('merged worktree follow-up', () => {
  test('respects Git worktree locks and refuses unrelated merge evidence', () => {
    const repo = repository();
    try {
      repo.git('worktree', 'lock', repo.path);
      const locked = repo.remove();
      repo.git('worktree', 'unlock', repo.path);
      repo.pr.merge = repo.git('rev-parse', 'HEAD^');
      const unrelated = repo.remove();
      assert({
        given: 'a locked worktree or a merge that does not carry its head',
        should: 'preserve its files and agents',
        actual: [
          locked !== 'removed',
          unrelated !== 'removed',
          existsSync(repo.path),
          repo.retired,
        ],
        expected: [true, true, true, []],
      });
    } finally {
      repo.cleanup();
    }
  });
  test('removes the exact clean merged worktree before retiring its agents', () => {
    const repo = repository();
    try {
      const result = repo.remove();
      assert({
        given: 'a clean worktree at the merged PR head',
        should: 'remove only that worktree and then retire its agents',
        actual: [
          result,
          existsSync(repo.path),
          existsSync(repo.cwd),
          repo.retired,
          repo.git('worktree', 'list').includes(repo.path),
        ],
        expected: ['removed', false, true, ['wt-slice'], false],
      });
    } finally {
      repo.cleanup();
    }
  });

  for (const [name, edit] of [
    [
      'tracked edit',
      (path: string) => writeFileSync(join(path, 'source.txt'), 'unique'),
    ],
    [
      'untracked note',
      (path: string) => writeFileSync(join(path, 'note.txt'), 'unique'),
    ],
    [
      'ignored environment',
      (path: string) => writeFileSync(join(path, '.env'), 'unique'),
    ],
    [
      'ignored note',
      (path: string) => writeFileSync(join(path, 'notes.private'), 'unique'),
    ],
  ] as const) {
    test(`preserves a ${name}`, () => {
      const repo = repository();
      try {
        edit(repo.path);
        repo.remove();
        assert({
          given: name,
          should: 'keep the worktree and its agents',
          actual: [existsSync(repo.path), repo.retired],
          expected: [true, []],
        });
      } finally {
        repo.cleanup();
      }
    });
  }

  test('preserves commits added after the merged head', () => {
    const repo = repository();
    try {
      writeFileSync(join(repo.path, 'source.txt'), 'next work');
      repo.git('-C', repo.path, 'commit', '-qam', 'unique');
      repo.remove();
      assert({
        given: 'a clean worktree with a new commit',
        should: 'preserve the unique commit and its agents',
        actual: [existsSync(repo.path), repo.retired],
        expected: [true, []],
      });
    } finally {
      repo.cleanup();
    }
  });

  for (const state of ['OPEN', 'CLOSED']) {
    test(`preserves an ${state} PR worktree`, () => {
      const repo = repository();
      try {
        repo.pr.state = state;
        repo.remove();
        assert({
          given: 'a PR without a verified merge',
          should: 'leave the worktree and agents alone',
          actual: [existsSync(repo.path), repo.retired],
          expected: [true, []],
        });
      } finally {
        repo.cleanup();
      }
    });
  }

  test('preserves the caller worktree and a mismatched branch', () => {
    const repo = repository();
    try {
      const current = removeMergedWorktree(
        repo.path,
        repo.pr,
        repo.worktree,
        () => repo.retired.push('current'),
      );
      repo.worktree.branch = 'pu/other';
      const other = repo.remove();
      assert({
        given: 'the caller itself or an unrelated managed branch',
        should: 'preserve both without retiring agents',
        actual: [
          current !== 'removed',
          other !== 'removed',
          existsSync(repo.path),
          repo.retired,
        ],
        expected: [true, true, true, []],
      });
    } finally {
      repo.cleanup();
    }
  });

  test('allows disposable dependency output but preserves a recreated remote branch', () => {
    const repo = repository();
    try {
      mkdirSync(join(repo.path, 'node_modules'));
      writeFileSync(join(repo.path, 'node_modules', 'generated'), 'generated');
      repo.git('update-ref', 'refs/remotes/origin/pu/slice', repo.pr.head);
      repo.remove();
      const preserved = existsSync(repo.path);
      repo.git('update-ref', '-d', 'refs/remotes/origin/pu/slice');
      const removed = repo.remove();
      assert({
        given: 'generated dependencies and a retained remote ref',
        should:
          'wait until the remote branch is absent, then remove the clean worktree',
        actual: [preserved, removed, repo.retired],
        expected: [true, 'removed', ['wt-slice']],
      });
    } finally {
      repo.cleanup();
    }
  });
});
