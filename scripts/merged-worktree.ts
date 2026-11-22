import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { sep } from 'node:path';

type MergedWorktreePr = {
  readonly state: string;
  readonly branch: string;
  readonly head: string;
  readonly merge: string;
};

type ManagedWorktree = {
  readonly id: string;
  readonly path: string;
  readonly branch: string;
};

type CleanupEvidence = {
  readonly mergedBranch: boolean;
  readonly validCommitIds: boolean;
  readonly current: boolean;
  readonly exactRegistration: boolean;
  readonly headMerged: boolean;
  readonly clean: boolean;
  readonly hiddenIndexEntries: boolean;
  readonly remoteAbsent: boolean;
};

/** Every observation is explicit; failure never grants removal. */
export function mergedWorktreeDecision(evidence: CleanupEvidence): string {
  if (!evidence.mergedBranch)
    return 'preserved: PR is not the merged managed branch';
  if (!evidence.validCommitIds) return 'preserved: invalid merge evidence';
  if (evidence.current) return 'preserved: caller is in the worktree';
  if (!evidence.exactRegistration)
    return 'preserved: worktree head or registration changed';
  if (!evidence.headMerged)
    return 'preserved: merged commit does not contain this head';
  if (evidence.hiddenIndexEntries)
    return 'preserved: tracked contents hidden by index flags';
  if (!evidence.remoteAbsent)
    return 'preserved: retained remote ref requires a preserve-refs PurePoint operation';
  if (!evidence.clean) return 'preserved: unique edits or files';
  return 'remove';
}

export function removeMergedWorktree(
  cwd: string,
  pr: MergedWorktreePr,
  worktree: ManagedWorktree,
  retire: (id: string) => void,
): string {
  const path = realpathSync(worktree.path);
  const caller = realpathSync(cwd);
  const git = (args: readonly string[], directory = cwd) =>
    spawnSync('git', args, { cwd: directory, encoding: 'utf8' });
  const listing = git(['worktree', 'list', '--porcelain', '-z']);
  const record = listing.stdout
    .split('\0\0')
    .find((entry) => entry.split('\0').includes(`worktree ${path}`));
  const dirty = git(
    ['status', '--porcelain=v1', '--untracked-files=all'],
    path,
  );
  const ignored = git(
    [
      'ls-files',
      '--others',
      '--ignored',
      '--exclude-standard',
      '-z',
      '--',
      '.',
      ':(glob,exclude)**/node_modules/**',
      ':(glob,exclude)**/.next/**',
      ':(glob,exclude)**/.turbo/**',
      ':(glob,exclude)**/dist/**',
    ],
    path,
  );
  const index = git(['ls-files', '-v', '-z'], path);
  const decision = mergedWorktreeDecision({
    mergedBranch: pr.state === 'MERGED' && worktree.branch === pr.branch,
    validCommitIds: [pr.head, pr.merge].every((sha) =>
      /^[a-f0-9]{40}$/.test(sha),
    ),
    current: caller === path || caller.startsWith(`${path}${sep}`),
    exactRegistration:
      listing.status === 0 &&
      !!record?.split('\0').includes(`HEAD ${pr.head}`) &&
      record.split('\0').includes(`branch refs/heads/${pr.branch}`),
    headMerged:
      git(['merge-base', '--is-ancestor', pr.head, pr.merge]).status === 0,
    hiddenIndexEntries:
      index.status !== 0 ||
      index.stdout.split('\0').some((entry) => /^[a-zS]/.test(entry)),
    remoteAbsent:
      git([
        'ls-remote',
        '--exit-code',
        '--heads',
        'origin',
        `refs/heads/${pr.branch}`,
      ]).status === 2,
    clean:
      dirty.status === 0 &&
      ignored.status === 0 &&
      !dirty.stdout &&
      !ignored.stdout,
  });
  if (decision !== 'remove') return decision;
  // Never force removal: Git rechecks tracked/untracked changes and locks.
  if (git(['worktree', 'remove', '--', path]).status !== 0)
    return 'preserved: Git refused removal';
  retire(worktree.id);
  return 'removed';
}
