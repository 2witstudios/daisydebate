/**
 * CI evidence in a review record. A Gates run line may cite a GitHub
 * Actions job instead of a local run:
 *
 *   Integration: PASS (CI run <run url>, job <job name>, sha <40-hex>)
 *   E2E: PASS (CI run <run url>, job <job name>, sha <40-hex>)
 *
 * The review-record check never trusts the line: it reads the run and its
 * latest jobs from the GitHub API and accepts the citation only when the
 * run belongs to this repository, ran the gate's own workflow on the
 * reviewed SHA from this repository (never a fork), was triggered by this
 * PR into the default branch or by a push to the default branch, the PR does
 * not change that workflow, and the named job concluded success. Anything it cannot verify refuses the record with its reason.
 */
import type { PullRequest } from './review-record-io';

export type CiGate = 'Integration' | 'E2E';

export type CiCitation = {
  readonly gate: CiGate;
  readonly url: string;
  readonly job: string;
  readonly sha: string;
};

export type CiJob = {
  readonly name: string;
  readonly status: string;
  readonly conclusion: string | null;
};

/** A workflow run as the GitHub API reports it, with its latest jobs. */
export type CiRun = {
  readonly id: string;
  readonly repository: string;
  readonly headRepository: string | undefined;
  readonly headSha: string;
  readonly event: string;
  readonly path: string;
  /** The branch a push run pushed; a pull_request run's PR head branch. */
  readonly headBranch: string | undefined;
  /** The PRs a pull_request run ran for, with each one's base branch. */
  readonly pullRequests: readonly {
    readonly number: number;
    readonly baseRef: string;
  }[];
  readonly jobs: readonly CiJob[];
};

/** The runs the edge read for this repository; a run absent here was unreadable. */
export type CiEvidence = {
  readonly repository: string;
  readonly runs: readonly CiRun[];
};

/** Each gate's workflow and the only jobs that evidence it. */
const CI_GATES: Readonly<
  Record<
    CiGate,
    { readonly workflow: string; readonly jobs: readonly string[] }
  >
> = {
  Integration: {
    workflow: '.github/workflows/ci.yml',
    jobs: ['Infrastructure contracts'],
  },
  E2E: {
    workflow: '.github/workflows/e2e.yml',
    jobs: ['Playwright E2E', 'Isolated Room Launch E2E'],
  },
};

const CLAIM = /^(Integration|E2E):\s*PASS\b/;
const CITATION =
  /^(Integration|E2E):\s*PASS\s*\(CI run (\S+), job ([^,()]+?), sha ([0-9a-f]{40})\)/;
const RUN_URL =
  /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/actions\/runs\/(\d+)$/;

/**
 * Every CI claim among Gates run lines: a citation, or the claim line
 * itself when it does not read as one, so a malformed claim refuses the
 * record instead of being ignored.
 */
export function ciClaims(
  lines: readonly string[],
): readonly (CiCitation | { readonly malformed: string })[] {
  return lines
    .filter((line) => CLAIM.test(line))
    .map((line) => {
      const match = CITATION.exec(line);
      return match
        ? {
            gate: match[1] as CiGate,
            url: match[2],
            job: match[3].trim(),
            sha: match[4],
          }
        : { malformed: line };
    });
}

/** The run id a citation names, or undefined for a URL that is not a run. */
export const citedRunId = (citation: CiCitation): string | undefined =>
  RUN_URL.exec(citation.url)?.[2];

const short = (sha: string): string => sha.slice(0, 7);
const sameRepository = (a: string | undefined, b: string): boolean =>
  a !== undefined && a.toLowerCase() === b.toLowerCase();

/**
 * Why the PR cannot rest on CI runs of the gate's workflow, if it cannot: a
 * run executes the workflow and code merged onto its base, so only a PR
 * into the default branch that leaves the workflow alone ran the real gate.
 */
function pullRequestProblem(
  pr: PullRequest,
  workflow: string,
): string | undefined {
  const { diff, headSha } = pr;
  if (!pr.defaultBranch || pr.baseRef !== pr.defaultBranch)
    return `CI evidence counts only for a PR into the default branch, not ${pr.baseRef ?? 'an unknown base'}`;
  if (!diff?.complete || diff.headSha !== headSha)
    return 'The PR diff could not be read completely, so CI evidence cannot be verified';
  return diff.files.some(
    (file) => file.path === workflow || file.previousPath === workflow,
  )
    ? `The PR changes ${workflow}, so its own CI run cannot be evidence`
    : undefined;
}

/** Why a citation does not verify against the runs read; undefined when it does. */
function citationProblem(
  citation: CiCitation,
  pr: PullRequest,
  evidence: CiEvidence,
): string | undefined {
  const { headSha } = pr;
  const url = RUN_URL.exec(citation.url);
  if (!url)
    return `CI run URL ${citation.url} is not https://github.com/<owner>/<repo>/actions/runs/<id>`;
  const [, cited, id] = url;
  const { workflow, jobs } = CI_GATES[citation.gate];
  if (citation.sha !== headSha)
    return `${citation.gate} evidence cites ${short(citation.sha)}, not the reviewed ${short(headSha)}`;
  if (!jobs.includes(citation.job))
    return `${citation.gate} evidence must cite job ${jobs.map((job) => `"${job}"`).join(' or ')}, not "${citation.job}"`;
  if (!sameRepository(cited, evidence.repository))
    return `CI run ${id} belongs to ${cited}, not ${evidence.repository}`;
  const changed = pullRequestProblem(pr, workflow);
  if (changed) return changed;
  const run = evidence.runs.find((candidate) => candidate.id === id);
  return run
    ? runProblem(run, citation, pr, evidence.repository)
    : `CI run ${id} could not be read; review-record fails closed`;
}

/** Why the run GitHub reported does not evidence the citation, if it does not. */
function runProblem(
  run: CiRun,
  citation: CiCitation,
  pr: PullRequest,
  repository: string,
): string | undefined {
  const { id } = run;
  const { headSha } = pr;
  const { workflow } = CI_GATES[citation.gate];
  if (!sameRepository(run.repository, repository))
    return `CI run ${id} belongs to ${run.repository}, not ${repository}`;
  if (!sameRepository(run.headRepository, repository))
    return `CI run ${id} ran code from ${run.headRepository ?? 'an unknown repository'}, not ${repository}`;
  const trigger = triggerProblem(run, pr);
  if (trigger) return trigger;
  if (run.path !== workflow)
    return `CI run ${id} ran ${run.path}, not ${workflow}`;
  if (run.headSha !== headSha)
    return `CI run ${id} ran ${short(run.headSha)}, not the reviewed ${short(headSha)}`;
  const named = run.jobs.filter((job) => job.name === citation.job);
  if (named.length === 0) return `CI run ${id} has no job "${citation.job}"`;
  const unfinished = named.find(
    (job) => job.status !== 'completed' || job.conclusion !== 'success',
  );
  return unfinished
    ? `CI job "${citation.job}" in run ${id} is ${unfinished.conclusion ?? unfinished.status}, not success`
    : undefined;
}

/**
 * Why the run's trigger is not this PR into the default branch or a push to
 * the default branch: a run for another PR, or onto another base, ran a
 * workflow and code this PR's diff never showed.
 */
function triggerProblem(run: CiRun, pr: PullRequest): string | undefined {
  const { id } = run;
  if (run.event === 'push')
    return run.headBranch === pr.defaultBranch
      ? undefined
      : `CI run ${id} pushed ${run.headBranch ?? 'an unknown branch'}, not ${pr.defaultBranch}`;
  if (run.event !== 'pull_request')
    return `CI run ${id} was triggered by ${run.event}, not pull_request or push`;
  return run.pullRequests.some(
    (candidate) =>
      candidate.number === pr.number && candidate.baseRef === pr.baseRef,
  )
    ? undefined
    : `CI run ${id} did not run for PR #${pr.number} into ${pr.baseRef}`;
}

/**
 * The first reason any CI claim in these Gates run lines fails to verify,
 * and the gates the verified citations evidence.
 */
export function verifyCiClaims(
  lines: readonly string[],
  pr: PullRequest,
  evidence: CiEvidence,
): {
  readonly problem: string | undefined;
  readonly gates: ReadonlySet<CiGate>;
} {
  const claims = ciClaims(lines);
  for (const claim of claims) {
    const problem =
      'malformed' in claim
        ? `CI evidence must read "<Integration|E2E>: PASS (CI run <run url>, job <name>, sha <40-hex>)"`
        : citationProblem(claim, pr, evidence);
    if (problem) return { problem, gates: new Set() };
  }
  return {
    problem: undefined,
    gates: new Set(
      claims.flatMap((claim) => ('malformed' in claim ? [] : [claim.gate])),
    ),
  };
}
