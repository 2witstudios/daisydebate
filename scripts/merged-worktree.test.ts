import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  mergedWorktreeDecision,
  removeMergedWorktree,
} from './merged-worktree';

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
  git('init', '-q', '--bare', join(root, 'remote.git'));
  git('remote', 'add', 'origin', join(root, 'remote.git'));
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
  test('does not enumerate disposable dependency files into a bounded output buffer', () => {
    const repo = repository();
    try {
      const dependencies = join(repo.path, 'node_modules');
      mkdirSync(dependencies);
      for (let index = 0; index < 10_000; index++)
        writeFileSync(
          join(dependencies, `${'generated-'.repeat(12)}${index}`),
          '',
        );
      const removed = repo.remove();
      assert({
        given: 'more than a megabyte of ignored dependency paths',
        should:
          'exclude them from the uniqueness scan and retire the clean worktree',
        actual: [removed, existsSync(repo.path), repo.retired],
        expected: ['removed', false, ['wt-slice']],
      });
    } finally {
      repo.cleanup();
    }
  });
  test('makes a pure fail-closed decision for each observed refusal', () => {
    const clean = {
      mergedBranch: true,
      validCommitIds: true,
      current: false,
      exactRegistration: true,
      headMerged: true,
      clean: true,
      hiddenIndexEntries: false,
      remoteAbsent: true,
    };
    const refusals = [
      { mergedBranch: false },
      { validCommitIds: false },
      { current: true },
      { exactRegistration: false },
      { headMerged: false },
      { clean: false },
      { hiddenIndexEntries: true },
      { remoteAbsent: false },
    ];
    assert({
      given: 'complete clean evidence and each independent refusal',
      should: 'authorize removal only for complete clean evidence',
      actual: [
        mergedWorktreeDecision(clean),
        refusals.every(
          (refusal) =>
            mergedWorktreeDecision({ ...clean, ...refusal }) !== 'remove',
        ),
      ],
      expected: ['remove', true],
    });
  });
  for (const flag of ['--skip-worktree', '--assume-unchanged']) {
    test(`preserves unique contents hidden by ${flag}`, () => {
      const repo = repository();
      try {
        repo.git('-C', repo.path, 'update-index', flag, 'source.txt');
        writeFileSync(join(repo.path, 'source.txt'), 'hidden unique edit');
        repo.remove();
        assert({
          given: 'a tracked edit hidden by an index flag',
          should: 'preserve the worktree and agents',
          actual: [existsSync(repo.path), repo.retired],
          expected: [true, []],
        });
      } finally {
        repo.cleanup();
      }
    });
  }
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

  test('preserves retained remote refs at the supported-operation boundary', () => {
    const repo = repository();
    try {
      mkdirSync(join(repo.path, 'node_modules'));
      writeFileSync(join(repo.path, 'node_modules', 'generated'), 'generated');
      repo.git('push', '-q', 'origin', 'pu/slice');
      const removed = repo.remove();
      assert({
        given: 'generated dependencies and a retained remote ref',
        should:
          'preserve the worktree and refs without unsupported daemon mutation',
        actual: [
          removed.startsWith('preserved: retained remote'),
          existsSync(repo.path),
          repo.git('rev-parse', 'refs/remotes/origin/pu/slice') ===
            repo.pr.head,
          repo.retired,
        ],
        expected: [true, true, true, []],
      });
    } finally {
      repo.cleanup();
    }
  });
});

describe('normal local point-guard merge entry', () => {
  for (const remote of ['absent', 'retained', 'advanced'] as const) {
    test(`merges the exact head and follows up with a ${remote} source ref`, () => {
      const repo = repository();
      try {
        const managed = join(repo.cwd, '.pu/worktrees/wt-slice');
        mkdirSync(join(repo.cwd, '.pu/worktrees'), { recursive: true });
        repo.git('worktree', 'move', repo.path, managed);
        const bin = join(repo.root, 'bin');
        mkdirSync(bin);
        const fixture = join(repo.root, 'fixture.json');
        const manifest = join(repo.root, 'daemon.json');
        const calls = join(repo.root, 'calls.txt');
        writeFileSync(calls, '');
        writeFileSync(
          fixture,
          JSON.stringify({
            number: 61,
            title: 'slice',
            body: '',
            merged: false,
            merge_commit_sha: repo.pr.merge,
            head: {
              ref: repo.pr.branch,
              sha: repo.pr.head,
              repo: { full_name: 'test/repo' },
            },
            base: { ref: 'main', repo: { full_name: 'test/repo' } },
          }),
        );
        writeFileSync(
          manifest,
          JSON.stringify({
            worktrees: [
              { id: 'wt-slice', path: managed, branch: repo.pr.branch },
            ],
            rootAgent: 'point-guard',
          }),
        );
        repo.git('push', '-q', 'origin', `${repo.pr.merge}^:refs/heads/main`);
        if (remote !== 'absent') repo.git('push', '-q', 'origin', 'pu/slice');
        if (remote === 'advanced') {
          writeFileSync(join(repo.cwd, 'next.txt'), 'unmerged remote work');
          repo.git('add', 'next.txt');
          repo.git('commit', '-qm', 'next work');
          repo.git('push', '-q', 'origin', 'HEAD:refs/heads/pu/slice');
        }
        const remoteBefore = repo.git(
          'ls-remote',
          'origin',
          'refs/heads/pu/slice',
        );
        writeFileSync(
          join(bin, 'gh'),
          `#!/usr/bin/env bun
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const args = process.argv.slice(2);
const pr = JSON.parse(readFileSync(process.env.FIXTURE, 'utf8'));
if (args[0] === 'repo') console.log(JSON.stringify({nameWithOwner:'test/repo'}));
else if (args[0] === 'api') console.log(JSON.stringify(pr));
else if (args[0] === 'pr' && args[1] === 'merge') {
  if (!args.includes('--match-head-commit') || args.at(-1) !== pr.head.sha) process.exit(2);
  execFileSync('git', ['push', '-q', 'origin', pr.merge_commit_sha + ':refs/heads/main']);
  pr.merged = true;
  writeFileSync(process.env.FIXTURE, JSON.stringify(pr));
  appendFileSync(process.env.CALLS, 'merge\\n');
} else process.exit(3);
`,
        );
        writeFileSync(
          join(bin, 'pu'),
          `#!/usr/bin/env bun
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
const args = process.argv.slice(2);
const state = JSON.parse(readFileSync(process.env.MANIFEST, 'utf8'));
if (args[2] === 'status') console.log(JSON.stringify(state));
else if (args[2] === 'clean') {
  if (existsSync(state.worktrees[0].path)) process.exit(4);
  state.worktrees = [];
  writeFileSync(process.env.MANIFEST, JSON.stringify(state));
  appendFileSync(process.env.CALLS, 'retire\\n');
  console.log(JSON.stringify({directory_removed:true,error:null}));
} else process.exit(5);
`,
        );
        chmodSync(join(bin, 'gh'), 0o755);
        chmodSync(join(bin, 'pu'), 0o755);
        const result = Bun.spawnSync(
          [
            process.execPath,
            new URL('./local-merge-followup.ts', import.meta.url).pathname,
            '61',
            repo.pr.head,
          ],
          {
            cwd: repo.cwd,
            env: {
              ...process.env,
              PATH: `${bin}:${process.env.PATH}`,
              FIXTURE: fixture,
              MANIFEST: manifest,
              CALLS: calls,
            },
          },
        );
        const state = JSON.parse(readFileSync(manifest, 'utf8'));
        assert({
          given: `the normal merge entry and a ${remote} remote ref`,
          should:
            'merge exactly once, retire only when supported, and preserve all remote refs and the point guard',
          actual: [
            result.exitCode,
            readFileSync(calls, 'utf8'),
            existsSync(managed),
            state.worktrees.length,
            state.rootAgent,
            repo.git('ls-remote', 'origin', 'refs/heads/pu/slice'),
          ],
          expected: [
            0,
            remote === 'absent' ? 'merge\nretire\n' : 'merge\n',
            remote !== 'absent',
            remote === 'absent' ? 0 : 1,
            'point-guard',
            remoteBefore,
          ],
        });
      } finally {
        repo.cleanup();
      }
    });
  }
});
