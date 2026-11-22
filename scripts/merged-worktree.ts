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

export function removeMergedWorktree(
  cwd: string,
  pr: MergedWorktreePr,
  worktree: ManagedWorktree,
  retire: (id: string) => void,
): string {
  if (pr.state !== 'MERGED' || worktree.branch !== pr.branch)
    return 'preserved: PR is not the merged managed branch';
  if (![pr.head, pr.merge].every((sha) => /^[a-f0-9]{40}$/.test(sha)))
    return 'preserved: invalid merge evidence';
  const path = realpathSync(worktree.path);
  const caller = realpathSync(cwd);
  if (caller === path || caller.startsWith(`${path}${sep}`))
    return 'preserved: caller is in the worktree';
  const git = (args: readonly string[], directory = cwd) =>
    spawnSync('git', args, { cwd: directory, encoding: 'utf8' });
  const listing = git(['worktree', 'list', '--porcelain', '-z']);
  const record = listing.stdout
    .split('\0\0')
    .find((entry) => entry.split('\0').includes(`worktree ${path}`));
  if (
    listing.status !== 0 ||
    !record?.split('\0').includes(`HEAD ${pr.head}`) ||
    !record.split('\0').includes(`branch refs/heads/${pr.branch}`)
  )
    return 'preserved: worktree head or registration changed';
  if (git(['merge-base', '--is-ancestor', pr.head, pr.merge]).status !== 0)
    return 'preserved: merged commit does not contain this head';
  // pu clean also deletes the remote branch. Do not hand it a live ref.
  if (
    git(['show-ref', '--verify', '--quiet', `refs/remotes/origin/${pr.branch}`])
      .status !== 1
  )
    return 'preserved: remote branch still exists or cannot be checked';
  const dirty = git(
    ['status', '--porcelain=v1', '--untracked-files=all'],
    path,
  );
  const ignored = git(
    ['ls-files', '--others', '--ignored', '--exclude-standard', '-z'],
    path,
  );
  const uniqueIgnored = ignored.stdout
    .split('\0')
    .filter(Boolean)
    .some(
      (file) =>
        !file
          .split('/')
          .some((part) =>
            ['node_modules', '.next', '.turbo', 'dist'].includes(part),
          ),
    );
  if (
    dirty.status !== 0 ||
    ignored.status !== 0 ||
    dirty.stdout ||
    uniqueIgnored
  )
    return 'preserved: unique edits or files';
  // Never force removal: Git rechecks tracked/untracked changes and locks.
  if (git(['worktree', 'remove', '--', path]).status !== 0)
    return 'preserved: Git refused removal';
  retire(worktree.id);
  return 'removed';
}
