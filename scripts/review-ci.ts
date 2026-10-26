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
 * reviewed SHA from this repository (a pull_request or push, never a fork),
 * the PR does not change that workflow, and the named job concluded
 * success. Anything it cannot verify refuses the record with its reason.
 */
import type { ReviewDiff } from './review-diff';

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

/** Why the PR's own changes make its CI runs unusable, if they do. */
function diffProblem(
  diff: ReviewDiff | undefined,
  headSha: string,
  workflow: string,
): string | undefined {
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
  headSha: string,
  diff: ReviewDiff | undefined,
  evidence: CiEvidence,
): string | undefined {
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
  const changed = diffProblem(diff, headSha, workflow);
  if (changed) return changed;
  const run = evidence.runs.find((candidate) => candidate.id === id);
  return run
    ? runProblem(run, citation, headSha, evidence.repository)
    : `CI run ${id} could not be read; review-record fails closed`;
}

/** Why the run GitHub reported does not evidence the citation, if it does not. */
function runProblem(
  run: CiRun,
  citation: CiCitation,
  headSha: string,
  repository: string,
): string | undefined {
  const { id } = run;
  const { workflow } = CI_GATES[citation.gate];
  if (!sameRepository(run.repository, repository))
    return `CI run ${id} belongs to ${run.repository}, not ${repository}`;
  if (!sameRepository(run.headRepository, repository))
    return `CI run ${id} ran code from ${run.headRepository ?? 'an unknown repository'}, not ${repository}`;
  if (run.event !== 'pull_request' && run.event !== 'push')
    return `CI run ${id} was triggered by ${run.event}, not pull_request or push`;
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
 * The first reason any CI claim in these Gates run lines fails to verify,
 * and the gates the verified citations evidence.
 */
export function verifyCiClaims(
  lines: readonly string[],
  headSha: string,
  diff: ReviewDiff | undefined,
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
        : citationProblem(claim, headSha, diff, evidence);
    if (problem) return { problem, gates: new Set() };
  }
  return {
    problem: undefined,
    gates: new Set(
      claims.flatMap((claim) => ('malformed' in claim ? [] : [claim.gate])),
    ),
  };
}
