// CI evidence in a review record: a Gates run line may cite a CI job
// instead of a local run, and the check verifies it against the runs the
// edge read from GitHub, failing closed on anything it cannot verify.
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { CiEvidence, CiRun } from './review-ci';
import { citedRunIds, verifyReviewRecord } from './review-record';
import { ciRunFromApi, readCiEvidence } from './review-record-io';
import { pr, record, sha } from './review-record.test-support';

setupRitewayBun();

const repository = '2witstudios/daisydebate';
const runUrl = `https://github.com/${repository}/actions/runs/101`;
const clean = '0 blocker / 0 major / 0 minor / 0 nit — APPROVE';
const runtimePr = {
  ...pr,
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

const ciRun = (overrides: Partial<CiRun> = {}): CiRun => ({
  id: '101',
  repository,
  headRepository: repository,
  headSha: sha,
  event: 'pull_request',
  path: '.github/workflows/ci.yml',
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
const evidence = (run: CiRun = ciRun()): CiEvidence => ({
  repository,
  runs: [run],
});

const citing = (line: string) =>
  record({
    verdict: clean,
    gates: [line, 'Negative control run: yes (below)'].join('\n'),
  });
const integration = (
  url = runUrl,
  job = 'Infrastructure contracts',
  cited = sha,
) => `Integration: PASS (CI run ${url}, job ${job}, sha ${cited})`;

const judge = (line: string, ci: CiEvidence = evidence(), target = runtimePr) =>
  verifyReviewRecord(target, [citing(line)], [], ci).description;

describe('verifyReviewRecord with CI evidence', () => {
  test('accepts a verified CI integration citation in place of a local run', () => {
    assert({
      given:
        'a runtime record citing the CI integration job that passed on the reviewed SHA',
      should: 'set review-record to success',
      actual: verifyReviewRecord(
        runtimePr,
        [citing(`- \`${integration()}\``)],
        [],
        evidence(),
      ).state,
      expected: 'success',
    });
  });

  test('refuses a citation whose SHA is not the reviewed head', () => {
    const other = 'b'.repeat(40);
    assert({
      given: 'a line citing another SHA, and a run that ran another SHA',
      should: 'fail naming the mismatch',
      actual: [
        judge(integration(runUrl, 'Infrastructure contracts', other)),
        judge(integration(), evidence(ciRun({ headSha: other }))),
      ],
      expected: [
        'Integration evidence cites bbbbbbb, not the reviewed aaaaaaa',
        'CI run 101 ran bbbbbbb, not the reviewed aaaaaaa',
      ],
    });
  });

  test('refuses a run of another repository', () => {
    assert({
      given:
        'a citation linking another repository, and an API run reporting another repository',
      should: 'fail naming the repository',
      actual: [
        judge(
          integration('https://github.com/evil/daisydebate/actions/runs/101'),
        ),
        judge(
          integration(),
          evidence(ciRun({ repository: 'evil/daisydebate' })),
        ),
      ],
      expected: [
        `CI run 101 belongs to evil/daisydebate, not ${repository}`,
        `CI run 101 belongs to evil/daisydebate, not ${repository}`,
      ],
    });
  });

  test('refuses a job that failed, is still running, or is missing', () => {
    const job = (status: string, conclusion: string | null) =>
      ciRun({
        jobs: [{ name: 'Infrastructure contracts', status, conclusion }],
      });
    assert({
      given: 'the cited job failed, still in progress, and absent from the run',
      should: 'fail each with the job state',
      actual: [
        judge(integration(), evidence(job('completed', 'failure'))),
        judge(integration(), evidence(job('in_progress', null))),
        judge(integration(), evidence(ciRun({ jobs: [] }))),
      ],
      expected: [
        'CI job "Infrastructure contracts" in run 101 is failure, not success',
        'CI job "Infrastructure contracts" in run 101 is in_progress, not success',
        'CI run 101 has no job "Infrastructure contracts"',
      ],
    });
  });

  test('refuses a run of fork code or from another trigger or workflow', () => {
    assert({
      given:
        'a run from a fork head, a workflow_dispatch run, and a run of another workflow',
      should: 'fail each with its reason',
      actual: [
        judge(
          integration(),
          evidence(ciRun({ headRepository: 'fork/daisydebate' })),
        ),
        judge(integration(), evidence(ciRun({ event: 'workflow_dispatch' }))),
        judge(
          integration(),
          evidence(ciRun({ path: '.github/workflows/e2e.yml' })),
        ),
      ],
      expected: [
        `CI run 101 ran code from fork/daisydebate, not ${repository}`,
        'CI run 101 was triggered by workflow_dispatch, not pull_request or push',
        'CI run 101 ran .github/workflows/e2e.yml, not .github/workflows/ci.yml',
      ],
    });
  });

  test('refuses a malformed URL, a malformed claim, and a job that is not the gate', () => {
    assert({
      given:
        'a non-run URL, a claim without a citation, and a citation naming the lint job',
      should: 'fail each with its reason',
      actual: [
        judge(integration('https://example.com/actions/runs/101')),
        judge('Integration: PASS (CI, trust me)'),
        judge(integration(runUrl, 'lint')),
      ],
      expected: [
        'CI run URL https://example.com/actions/runs/101 is not https://github.com/<owner>/<repo>/actions/runs/<id>',
        'CI evidence must read "<Integration|E2E>: PASS (CI run <run url>, job <name>, sha <40-hex>)"',
        'Integration evidence must cite job "Infrastructure contracts", not "lint"',
      ],
    });
  });

  test('fails closed on an unread run, an unreadable diff, or a PR that changes the workflow', () => {
    const changesCi = {
      ...runtimePr,
      diff: {
        ...runtimePr.diff,
        files: [
          ...runtimePr.diff.files,
          {
            path: '.github/workflows/ci.yml',
            status: 'modified',
            oldMode: '100644',
            newMode: '100644',
          },
        ],
      },
    };
    assert({
      given:
        'no run read from the API, no PR diff, and a PR diff that edits ci.yml',
      should: 'refuse each instead of trusting the line',
      actual: [
        judge(integration(), { repository, runs: [] }),
        judge(integration(), evidence(), pr),
        judge(integration(), evidence(), changesCi),
      ],
      expected: [
        'CI run 101 could not be read; review-record fails closed',
        'The PR diff could not be read completely, so CI evidence cannot be verified',
        'The PR changes .github/workflows/ci.yml, so its own CI run cannot be evidence',
      ],
    });
  });

  test('verifies a cited E2E job too, and never lets it stand in for integration', () => {
    const e2eRun = ciRun({
      id: '202',
      path: '.github/workflows/e2e.yml',
      jobs: [
        { name: 'Playwright E2E', status: 'completed', conclusion: 'success' },
        {
          name: 'Isolated Room Launch E2E',
          status: 'completed',
          conclusion: 'failure',
        },
      ],
    });
    const e2e = (job: string) =>
      `E2E: PASS (CI run https://github.com/${repository}/actions/runs/202, job ${job}, sha ${sha})`;
    const both = (job: string) =>
      record({
        verdict: clean,
        gates: [integration(), e2e(job), 'Negative control run: yes'].join(
          '\n',
        ),
      });
    const ci = { repository, runs: [ciRun(), e2eRun] };
    assert({
      given:
        'integration plus a passed E2E job, plus a failed E2E job, and an E2E citation alone',
      should:
        'pass the first, refuse the failed job, and refuse E2E as integration evidence',
      actual: [
        verifyReviewRecord(runtimePr, [both('Playwright E2E')], [], ci).state,
        verifyReviewRecord(
          runtimePr,
          [both('Isolated Room Launch E2E')],
          [],
          ci,
        ).description,
        judge(e2e('Playwright E2E'), ci),
      ],
      expected: [
        'success',
        'CI job "Isolated Room Launch E2E" in run 202 is failure, not success',
        'Runtime or unclassified acceptance needs bun test:integration PASS or verified CI Integration, and a negative control in Gates run',
      ],
    });
  });

  test('keeps the negative control required with CI evidence', () => {
    assert({
      given: 'a verified CI integration citation without a negative control',
      should: 'fail for missing evidence',
      actual: verifyReviewRecord(
        runtimePr,
        [record({ verdict: clean, gates: integration() })],
        [],
        evidence(),
      ).description,
      expected:
        'Runtime or unclassified acceptance needs bun test:integration PASS or verified CI Integration, and a negative control in Gates run',
    });
  });
});

describe('citedRunIds', () => {
  test('collects each cited run once, only from Gates run, never from a bad URL', () => {
    assert({
      given:
        'two records citing run 101, one also citing a non-run URL, and a citation quoted under Findings',
      should: 'return the run id once',
      actual: citedRunIds([
        citing(integration()),
        record({
          gates: [
            integration(),
            integration('https://example.com/runs/9'),
          ].join('\n'),
          findings: integration(
            `https://github.com/${repository}/actions/runs/303`,
          ),
        }),
      ]),
      expected: ['101'],
    });
  });
});

describe('ciRunFromApi', () => {
  const apiRun = {
    id: 101,
    head_sha: sha,
    event: 'pull_request',
    path: '.github/workflows/ci.yml',
    repository: { full_name: repository },
    head_repository: { full_name: repository },
  };
  const jobPages = [
    {
      jobs: [
        {
          name: 'Infrastructure contracts',
          status: 'completed',
          conclusion: 'success',
        },
      ],
    },
  ];

  test('reads a documented run and its paginated jobs', () => {
    assert({
      given: 'a run and one page of its latest jobs',
      should: 'return the run facts the verifier checks',
      actual: ciRunFromApi('101', apiRun, jobPages),
      expected: ciRun({
        jobs: [
          {
            name: 'Infrastructure contracts',
            status: 'completed',
            conclusion: 'success',
          },
        ],
      }),
    });
  });

  test('refuses responses that are not the documented shape', () => {
    assert({
      given:
        'another run id, a run without a repository, and a jobs page without jobs',
      should: 'return undefined for each',
      actual: [
        ciRunFromApi('102', apiRun, jobPages),
        ciRunFromApi('101', { ...apiRun, repository: null }, jobPages),
        ciRunFromApi('101', apiRun, [{ total_count: 1 }]),
      ],
      expected: [undefined, undefined, undefined],
    });
  });
});

describe('readCiEvidence', () => {
  test('reads each cited run of this repository and leaves failed reads out', () => {
    const calls: (readonly string[])[] = [];
    const read = readCiEvidence(
      (args) => {
        calls.push(args);
        const path = args.at(-1) ?? '';
        if (path.includes('/runs/404')) return { code: 1, stdout: '' };
        return {
          code: 0,
          stdout: JSON.stringify(
            path.includes('/jobs')
              ? [{ jobs: [] }]
              : {
                  id: 101,
                  head_sha: sha,
                  event: 'push',
                  path: '.github/workflows/ci.yml',
                  repository: { full_name: repository },
                  head_repository: { full_name: repository },
                },
          ),
        };
      },
      repository,
      ['101', '404'],
    );
    assert({
      given: 'a readable run and one the API refuses',
      should:
        'return only the readable run, reading its latest jobs on every page',
      actual: [read.runs.map((run) => run.id), calls[1]],
      expected: [
        ['101'],
        [
          'api',
          '--paginate',
          '--slurp',
          `repos/${repository}/actions/runs/101/jobs?filter=latest&per_page=100`,
        ],
      ],
    });
  });
});
