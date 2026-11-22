import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { removeMergedWorktree } from './merged-worktree';
import { committedPreparationProblems } from './prepare-pr';

const repoSchema = z.object({ full_name: z.string() });
const prSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  body: z.string().nullable(),
  merged: z.boolean(),
  merge_commit_sha: z.string().nullable(),
  head: z.object({
    ref: z.string(),
    sha: z.string(),
    repo: repoSchema.nullable(),
  }),
  base: z.object({ ref: z.string(), repo: repoSchema }),
});
const worktreeSchema = z.object({
  id: z.string(),
  path: z.string(),
  branch: z.string(),
});
const statusSchema = z.object({ worktrees: z.array(worktreeSchema) });

/** Local half of merge follow-up; the hosted board job has no local daemon. */
async function localMergeFollowup(
  number: number,
  mergeHead?: string,
  cwd = process.cwd(),
) {
  const run = (command: string, args: readonly string[]) => {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
    if (result.status !== 0)
      throw new Error(`${command} failed during local merge follow-up`, {
        cause: result.error ?? result.stderr,
      });
    return result.stdout.trim();
  };
  const repository = z
    .object({ nameWithOwner: z.string() })
    .parse(
      JSON.parse(run('gh', ['repo', 'view', '--json', 'nameWithOwner'])),
    ).nameWithOwner;
  const readPr = () =>
    prSchema.parse(
      JSON.parse(run('gh', ['api', `repos/${repository}/pulls/${number}`])),
    );
  let pr = readPr();
  if (mergeHead) {
    if (
      !/^[a-f0-9]{40}$/.test(mergeHead) ||
      pr.head.sha !== mergeHead ||
      pr.head.repo?.full_name !== repository ||
      pr.base.repo.full_name !== repository
    )
      throw new Error('The exact same-repository merge head is required');
    run('git', ['fetch', '--prune', 'origin']);
    const preparation = committedPreparationProblems(
      number,
      `refs/remotes/origin/${pr.base.ref}`,
      mergeHead,
      cwd,
    );
    if (preparation.length)
      throw new Error(
        `Prepare and requalify the candidate before merging: ${preparation.join('; ')}`,
      );
    run('gh', [
      'pr',
      'merge',
      String(number),
      '--merge',
      '--match-head-commit',
      mergeHead,
    ]);
    pr = readPr();
  }
  if (
    !pr.merged ||
    !pr.merge_commit_sha ||
    pr.head.repo?.full_name !== repository ||
    pr.base.repo.full_name !== repository ||
    pr.head.ref === pr.base.ref ||
    pr.head.ref === 'main'
  )
    throw new Error(
      'Local merge follow-up requires a merged same-repository slice',
    );
  run('git', ['fetch', '--prune', 'origin']);
  const mergeSha = pr.merge_commit_sha;
  run('git', [
    'merge-base',
    '--is-ancestor',
    pr.merge_commit_sha,
    `refs/remotes/origin/${pr.base.ref}`,
  ]);
  const common = run('git', [
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
  ]);
  const project = dirname(common);
  const pu = (args: readonly string[]) =>
    run('pu', ['--project', project, ...args]);
  const status = () => statusSchema.parse(JSON.parse(pu(['status', '--json'])));
  const worktrees = status().worktrees.filter(
    (worktree) => worktree.branch === pr.head.ref,
  );
  const cleanup = worktrees.map((worktree) => {
    // The daemon deletes a conventional path, not an arbitrary manifest path.
    if (
      realpathSync(worktree.path) !==
      realpathSync(resolve(project, '.pu/worktrees', worktree.id))
    )
      return { id: worktree.id, result: 'preserved: nonstandard managed path' };
    return {
      id: worktree.id,
      result: removeMergedWorktree(
        cwd,
        {
          state: 'MERGED',
          branch: pr.head.ref,
          head: pr.head.sha,
          merge: mergeSha,
        },
        worktree,
        (id) => {
          const current = status().worktrees.find((entry) => entry.id === id);
          if (
            !current ||
            current.path !== worktree.path ||
            current.branch !== worktree.branch
          )
            throw new Error('Managed worktree changed before retirement');
          z.object({
            directory_removed: z.literal(true),
            error: z.null().optional(),
          }).parse(JSON.parse(pu(['clean', '--worktree', id, '--json'])));
          if (status().worktrees.some((entry) => entry.id === id))
            throw new Error('PurePoint did not retire the removed worktree');
        },
      ),
    };
  });
  return { cleanup };
}

if (import.meta.main) {
  const number = Number(process.argv[2]);
  if (!Number.isSafeInteger(number) || number <= 0)
    throw new Error(
      'Usage: bun merge:followup <merged-pr-number> | bun merge:pr <pr-number> <exact-head>',
    );
  console.log(
    JSON.stringify(await localMergeFollowup(number, process.argv[3]), null, 2),
  );
}
