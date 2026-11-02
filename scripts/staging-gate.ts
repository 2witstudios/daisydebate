#!/usr/bin/env bun
/**
 * Decides whether deploy-staging ships a main commit: staging deploys when
 * the CI gate job is green, without waiting for Browser E2E (ADR 0098). The
 * gate needs every CI job, the dependency audit included (ADR 0039), so a new
 * advisory holds staging back.
 *
 *   bun scripts/staging-gate.ts --sha <commit>
 *
 * CI's completion triggers deploy-staging. A commit ships only while it is
 * still main's tip: a later re-run of an older commit's CI never rolls staging
 * back (ISSUE-59). Writes `deploy=true|false` to $GITHUB_OUTPUT when set, and
 * the reason to stdout.
 */
import { appendFileSync } from 'node:fs';

type Status = string;
type Conclusion = string | null;

export type StagingEvidence = {
  /** The commit the CI run verified. */
  readonly sha: string;
  /** main's head when the decision is made. */
  readonly mainTip: string;
  readonly ci?: {
    readonly status: Status;
    readonly gate: Conclusion;
  };
};

export type StagingDecision = {
  readonly deploy: boolean;
  readonly reason: string;
};

const GATE_JOB = 'CI gate';
const CI_PATH = '.github/workflows/ci.yml';

export function stagingDecision(evidence: StagingEvidence): StagingDecision {
  const { ci, sha, mainTip } = evidence;
  if (sha !== mainTip)
    return {
      deploy: false,
      reason: `${sha} is no longer main's tip (${mainTip})`,
    };
  if (!ci) return { deploy: false, reason: 'no CI run for this commit' };
  if (ci.status !== 'completed')
    return {
      deploy: false,
      reason: 'CI has not completed; its completion decides',
    };
  if (ci.gate !== 'success')
    return { deploy: false, reason: `the CI gate ended ${ci.gate ?? 'unrun'}` };
  return { deploy: true, reason: 'the CI gate is green' };
}

type Run = {
  readonly id: number;
  readonly path: string;
  readonly status: Status;
};

/** Reads the newest main push CI run and the CI gate's verdict. */
export function readStagingEvidence(
  api: (path: string) => unknown,
  input: {
    readonly repository: string;
    readonly sha: string;
  },
): StagingEvidence {
  const { sha: mainTip } = api(`repos/${input.repository}/commits/main`) as {
    readonly sha: string;
  };
  const base = `repos/${input.repository}/actions/runs`;
  const { workflow_runs: runs } = api(
    `${base}?head_sha=${input.sha}&event=push&branch=main&per_page=100`,
  ) as { readonly workflow_runs: readonly Run[] };
  const ciRun = runs
    .filter((run) => run.path === CI_PATH)
    .reduce<Run | undefined>(
      (best, run) => (best && best.id > run.id ? best : run),
      undefined,
    );
  const gate = () => {
    const { jobs } = api(
      `${base}/${ciRun?.id}/jobs?filter=latest&per_page=100`,
    ) as {
      readonly jobs: readonly {
        readonly name: string;
        readonly conclusion: Conclusion;
      }[];
    };
    return jobs.find((job) => job.name === GATE_JOB)?.conclusion ?? null;
  };
  return {
    sha: input.sha,
    mainTip,
    ...(ciRun && {
      ci: {
        status: ciRun.status,
        gate: ciRun.status === 'completed' ? gate() : null,
      },
    }),
  };
}

const argument = (name: string) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};

if (import.meta.main) {
  const sha = argument('--sha');
  const repository = process.env.GITHUB_REPOSITORY;
  if (!sha || !/^[0-9a-f]{40}$/.test(sha) || !repository) {
    process.stderr.write(
      'usage: GITHUB_REPOSITORY=<owner/repo> bun scripts/staging-gate.ts --sha <40-hex commit>\n',
    );
    process.exit(2);
  }
  const api = (path: string): unknown => {
    const result = Bun.spawnSync(['gh', 'api', path], {
      stdout: 'pipe',
      stderr: 'inherit',
    });
    if (result.exitCode !== 0)
      throw new Error(`gh api ${path} exited ${result.exitCode}`);
    return JSON.parse(result.stdout.toString());
  };
  const decision = stagingDecision(
    readStagingEvidence(api, { repository, sha }),
  );
  process.stdout.write(`${decision.reason}\n`);
  const output = process.env.GITHUB_OUTPUT;
  if (output) appendFileSync(output, `deploy=${decision.deploy}\n`);
}
