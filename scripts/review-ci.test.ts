// CI evidence in a review record: a Gates run line may cite a CI job
// instead of a local run, and the check verifies it against the runs the
// edge read from GitHub, failing closed on anything it cannot verify.
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { CiEvidence } from './review-ci';
import { verifyReviewRecord } from './review-record';
import { record, sha } from './review-record.test-support';
import {
  ciRun,
  citing,
  clean,
  evidence,
  integration,
  repository,
  runUrl,
  runtimePr,
} from './review-ci.test-support';

setupRitewayBun();

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
        judge(integration(), { ...evidence(), runs: [] }),
        judge(integration(), evidence(), { ...runtimePr, diff: undefined }),
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
    const ci = { ...evidence(), runs: [ciRun(), e2eRun] };
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

describe('verifyReviewRecord binds a CI run to this PR and its base', () => {
  const history = (sameHead: readonly number[], baseChanged = false) => ({
    ...evidence(),
    history: { sameHead, baseChanged },
  });

  test('refuses a run whose base this PR cannot prove was the default branch', () => {
    assert({
      given:
        'a run from another branch at the same SHA, a second PR from this head branch (a crafted base), a retargeted PR, unreadable history, a push to another branch, and a PR into another base',
      should:
        'refuse each, since that run may have tested a workflow this diff never showed',
      actual: [
        judge(integration(), evidence(ciRun({ headBranch: 'pu/other' }))),
        judge(integration(), history([57, 58])),
        judge(integration(), history([57], true)),
        judge(integration(), { ...evidence(), history: undefined }),
        judge(
          integration(),
          evidence(ciRun({ event: 'push', headBranch: 'evil-base' })),
        ),
        judge(integration(), evidence(), {
          ...runtimePr,
          baseRef: 'evil-base',
        }),
      ],
      expected: [
        'CI run 101 ran branch pu/other, not pu/builder',
        'PR #58 also used head branch pu/builder, so its CI runs are ambiguous',
        "The PR's base branch changed, so its CI runs may have tested another base",
        "The PR's history could not be read, so CI evidence cannot be verified",
        'CI run 101 ran branch evil-base, not main',
        'CI evidence counts only for a PR into the default branch, not evil-base',
      ],
    });
  });

  test('fails closed when the PR facts are missing', () => {
    assert({
      given: 'a PR without base, default or head branch facts',
      should: 'refuse CI evidence',
      actual: [
        judge(integration(), evidence(), {
          ...runtimePr,
          baseRef: undefined,
          defaultBranch: undefined,
        }),
        judge(integration(), evidence(), { ...runtimePr, headRef: undefined }),
      ],
      expected: [
        'CI evidence counts only for a PR into the default branch, not an unknown base',
        'CI evidence counts only for a PR into the default branch, not main',
      ],
    });
  });

  test('accepts a push run of the default branch on the reviewed SHA', () => {
    assert({
      given: 'a push run of main whose head is the reviewed SHA',
      should: 'verify',
      actual: verifyReviewRecord(
        runtimePr,
        [citing(integration())],
        [],
        evidence(ciRun({ event: 'push', headBranch: 'main' })),
      ).state,
      expected: 'success',
    });
  });
});

describe('verifyReviewRecord CI edge cases', () => {
  test('refuses a stale diff, a renamed workflow, and any failed attempt of a same-named job', () => {
    const renamed = {
      ...runtimePr,
      diff: {
        ...runtimePr.diff,
        files: [
          {
            path: '.github/workflows/old.yml',
            previousPath: '.github/workflows/ci.yml',
            status: 'renamed',
            oldMode: '100644',
            newMode: '100644',
          },
        ],
      },
    };
    const twice = ciRun({
      jobs: [
        {
          name: 'Infrastructure contracts',
          status: 'completed',
          conclusion: 'failure',
        },
        {
          name: 'Infrastructure contracts',
          status: 'completed',
          conclusion: 'success',
        },
      ],
    });
    assert({
      given:
        'a diff read for another SHA, a diff renaming ci.yml away, and two same-named jobs where the first failed',
      should: 'refuse each',
      actual: [
        judge(integration(), evidence(), {
          ...runtimePr,
          diff: { ...runtimePr.diff, headSha: 'b'.repeat(40) },
        }),
        judge(integration(), evidence(), renamed),
        judge(integration(), evidence(twice)),
      ],
      expected: [
        'The PR diff could not be read completely, so CI evidence cannot be verified',
        'The PR changes .github/workflows/ci.yml, so its own CI run cannot be evidence',
        'CI job "Infrastructure contracts" in run 101 is failure, not success',
      ],
    });
  });

  test('compares repositories without case, and reads a run URL PageSpace linked', () => {
    const linked = record({
      verdict: clean,
      gates: `<p>Integration: PASS (CI run <a href="${runUrl}">${runUrl}</a>, job Infrastructure contracts, sha ${sha})</p><p>Negative control run: yes</p>`,
    });
    assert({
      given:
        'a citation URL in another letter case, and a citation whose URL is an HTML link',
      should: 'verify both',
      actual: [
        verifyReviewRecord(
          runtimePr,
          [citing(integration(runUrl.replace('2witstudios', '2WitStudios')))],
          [],
          evidence(),
        ).state,
        verifyReviewRecord(runtimePr, [linked], [], evidence()).state,
      ],
      expected: ['success', 'success'],
    });
  });
});

describe('CI evidence refuses incomplete branch history and older PR runs', () => {
  test('requires the reviewed PR itself in the complete head-branch history', () => {
    assert({
      given: 'empty history or history containing only another closed PR',
      should: 'fail closed instead of accepting a branch-name match',
      actual: [[], [58]].map((sameHead) =>
        judge(integration(), {
          ...evidence(),
          history: { sameHead, baseChanged: false },
        }),
      ),
      expected: [0, 1].map(
        () =>
          'PR #57 is missing from its head branch history, so CI evidence cannot be verified',
      ),
    });
  });

  test('binds pull_request run creation to the reviewed PR lifetime', () => {
    const target = { ...runtimePr, createdAt: '2026-10-26T12:00:00Z' };
    assert({
      given:
        'an older run, missing or malformed timestamps, and a run created at the PR opening instant',
      should: 'accept only a run verifiably created during this PR lifetime',
      actual: [
        judge(
          integration(),
          evidence(ciRun({ createdAt: '2026-10-26T11:59:59Z' })),
          target,
        ),
        judge(integration(), evidence(ciRun({ createdAt: undefined })), target),
        judge(integration(), evidence(ciRun({ createdAt: 'invalid' })), target),
        judge(
          integration(),
          evidence(ciRun({ createdAt: '2026-10-26T12:00:00Z' })),
          { ...target, createdAt: undefined },
        ),
        judge(
          integration(),
          evidence(ciRun({ createdAt: '2026-10-26T12:00:00Z' })),
          target,
        ),
      ],
      expected: [
        'CI run 101 was created before PR #57, so it belongs to another PR',
        ...[0, 1, 2].map(
          () =>
            'CI run 101 or PR #57 has no valid creation time, so its PR provenance cannot be verified',
        ),
        'Independent review by ag-reviewer: APPROVE',
      ],
    });
  });
});
