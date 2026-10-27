import {
  fetchPullRequest,
  gh,
  ghAs,
  ghJson,
  readCiEvidence,
  readRecords,
  readPullRequestDiff,
  DAISY_DRIVE,
} from './review-record-io';
import {
  citedRunIds,
  linkedPageIds,
  verifyReviewRecord,
} from './review-record';

type QueueRun = {
  event: string;
  path: string;
  head_branch: string;
  head_sha: string;
  repository: { full_name: string };
  head_repository: { full_name: string };
};
/** Only GitHub's own queue event can request an exact-candidate review. */
export function queueReviewTarget(
  run: QueueRun,
  repository: string,
  defaultBranch: string,
) {
  const prefix = `gh-readonly-queue/${defaultBranch}/pr-`;
  const suffix = run.head_branch?.startsWith(prefix)
    ? run.head_branch.slice(prefix.length)
    : '';
  const number = /^(\d+)-/.exec(suffix)?.[1];
  if (
    run.event !== 'merge_group' ||
    run.path !== '.github/workflows/e2e.yml' ||
    run.repository?.full_name !== repository ||
    run.head_repository?.full_name !== repository ||
    !/^[a-f0-9]{40}$/.test(run.head_sha) ||
    !number
  )
    return undefined;
  return { number: Number(number), sha: run.head_sha, ref: run.head_branch };
}

if (import.meta.main) {
  const repository = process.env.GITHUB_REPOSITORY ?? '';
  const runId = process.env.QUEUE_RUN_ID ?? '';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^\d+$/.test(runId))
    throw new Error('Queue review requires repository and run id');
  const api = <T>(path: string): T => {
    const result = ghAs(process.env.CI_READ_TOKEN)([
      'api',
      `repos/${repository}/${path}`,
    ]);
    if (result.code !== 0) throw new Error('Queue facts could not be read');
    return JSON.parse(result.stdout) as T;
  };
  const { default_branch: defaultBranch } = api<{ default_branch: string }>('');
  const run = api<QueueRun>(`actions/runs/${runId}`);
  const target = queueReviewTarget(run, repository, defaultBranch);
  if (!target) throw new Error('Not a trusted merge queue browser run');
  const { pr, comments } = fetchPullRequest(repository, target.number);
  const tip = api<{ object: { sha: string } }>(`git/ref/heads/${target.ref}`);
  const commit = api<{ parents: { sha: string }[] }>(`commits/${target.sha}`);
  // Initial queue policy is a single PR. Never infer reviewed membership from a ref name alone.
  if (
    tip.object.sha !== target.sha ||
    commit.parents.length !== 2 ||
    commit.parents[1]?.sha !== pr.headSha ||
    pr.baseRef !== defaultBranch
  )
    throw new Error(
      'Queue candidate is stale or is not the exact single reviewed PR',
    );
  const base = commit.parents[0]!.sha;
  const baseAncestry = api<{ status: string }>(
    `compare/${base}...${defaultBranch}`,
  );
  if (!['identical', 'ahead'].includes(baseAncestry.status))
    throw new Error('Queue base is not an ancestor of default branch');
  const compared = api<{ files?: unknown[] }>(
    `compare/${base}...${target.sha}`,
  );
  // Compare truncates at 300: at the limit the evidence is ambiguous and refused.
  if (!compared.files || compared.files.length >= 300)
    throw new Error('Queue candidate diff is incomplete');
  const candidate = {
    ...pr,
    headSha: target.sha,
    queueRef: target.ref,
    diff: readPullRequestDiff(gh, repository, {
      head: { sha: target.sha },
      base: { sha: base },
      changed_files: compared.files.length,
    }),
  };
  const { records, unreadable } = await readRecords(
    linkedPageIds([pr.body, ...comments]),
  );
  const evidence = readCiEvidence(
    ghAs(process.env.CI_READ_TOKEN),
    repository,
    citedRunIds(records),
    candidate,
  );
  const verdict = verifyReviewRecord(candidate, records, unreadable, evidence);
  ghJson([
    'api',
    '-X',
    'POST',
    `repos/${repository}/statuses/${target.sha}`,
    '-f',
    `state=${verdict.state}`,
    '-f',
    'context=review-record',
    '-f',
    `description=${verdict.description.slice(0, 140)}`,
    ...(verdict.recordId
      ? [
          '-f',
          `target_url=https://pagespace.ai/dashboard/${DAISY_DRIVE}/${verdict.recordId}`,
        ]
      : []),
  ]);
  console.log(
    `Queue review ${target.sha}: ${verdict.state} — ${verdict.description}`,
  );
}
