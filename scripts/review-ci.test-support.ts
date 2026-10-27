// Shared fixtures for the CI-evidence tests: a runtime PR into main, a
// passing CI run of it, and a record citing that run.
import type { CiEvidence, CiRun } from './review-ci';
import { verifyReviewRecord } from './review-record';
import { pr, record, sha } from './review-record.test-support';

export const repository = '2witstudios/daisydebate';
export const runUrl = `https://github.com/${repository}/actions/runs/101`;
export const clean = '0 blocker / 0 major / 0 minor / 0 nit — APPROVE';
export const runtimePr = {
  ...pr,
  headRef: 'pu/builder',
  createdAt: '2026-10-26T12:00:00Z',
  baseRef: 'main',
  defaultBranch: 'main',
  diff: {
    headSha: sha,
    complete: true,
    files: [
      {
        path: 'scripts/x.ts',
        status: 'modified',
        oldMode: '100644',
        newMode: '100644',
      },
    ],
  },
};

export const ciRun = (overrides: Partial<CiRun> = {}): CiRun => ({
  id: '101',
  repository,
  headRepository: repository,
  headSha: sha,
  event: 'pull_request',
  path: '.github/workflows/ci.yml',
  headBranch: 'pu/builder',
  createdAt: '2026-10-26T12:00:01Z',
  jobs: [
    { name: 'lint', status: 'completed', conclusion: 'success' },
    {
      name: 'Infrastructure contracts',
      status: 'completed',
      conclusion: 'success',
    },
  ],
  ...overrides,
});
export const evidence = (run: CiRun = ciRun()): CiEvidence => ({
  repository,
  runs: [run],
  history: { sameHead: [57], baseChanged: false },
});

export const citing = (line: string) =>
  record({
    verdict: clean,
    gates: [line, 'Negative control run: yes (below)'].join('\n'),
  });
export const integration = (
  url = runUrl,
  job = 'Infrastructure contracts',
  cited = sha,
) => `Integration: PASS (CI run ${url}, job ${job}, sha ${cited})`;

export const judge = (
  line: string,
  ci: CiEvidence = evidence(),
  target = runtimePr,
) => verifyReviewRecord(target, [citing(line)], [], ci).description;
