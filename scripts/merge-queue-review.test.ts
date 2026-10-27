import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { queueReviewTarget } from './merge-queue-review';
setupRitewayBun();
const sha = 'a'.repeat(40);
describe('queueReviewTarget', () => {
  test('only accepts a native queue run for the repository default', () => {
    const run = {
      event: 'merge_group',
      path: '.github/workflows/e2e.yml',
      head_branch: 'gh-readonly-queue/main/pr-42-abc',
      head_sha: sha,
      repository: { full_name: '2witstudios/daisydebate' },
      head_repository: { full_name: '2witstudios/daisydebate' },
    };
    assert({
      given: 'a native queue Browser E2E run',
      should: 'identify the exact candidate and PR',
      actual: queueReviewTarget(run, '2witstudios/daisydebate', 'main'),
      expected: { number: 42, sha, ref: run.head_branch },
    });
    for (const changed of [
      { event: 'pull_request' },
      { head_branch: 'pu/branch' },
      { head_repository: { full_name: 'fork/repo' } },
      { head_sha: 'bad' },
    ]) {
      assert({
        given: 'an untrusted or unrelated run',
        should: 'refuse queue review',
        actual: queueReviewTarget(
          { ...run, ...changed },
          '2witstudios/daisydebate',
          'main',
        ),
        expected: undefined,
      });
    }
  });
});

describe('queue CI evidence', () => {
  test('accepts only the admitted queue ref and preserves workflow-change refusal', async () => {
    const { verifyCiClaims } = await import('./review-ci');
    const { runtimePr, evidence, ciRun, integration } =
      await import('./review-ci.test-support');
    const queueRef = 'gh-readonly-queue/main/pr-57-abc';
    const proof = evidence(
      ciRun({ event: 'merge_group', headBranch: queueRef }),
    );
    assert({
      given: 'an admitted exact queue candidate and full CI citation',
      should: 'accept that queue run',
      actual: verifyCiClaims([integration()], { ...runtimePr, queueRef }, proof)
        .problem,
      expected: undefined,
    });
    assert({
      given: 'queue evidence without candidate admission',
      should: 'refuse the event',
      actual: Boolean(
        verifyCiClaims([integration()], runtimePr, proof).problem,
      ),
      expected: true,
    });
    const changed = {
      ...runtimePr,
      queueRef,
      diff: {
        ...runtimePr.diff,
        files: [
          { ...runtimePr.diff.files[0], path: '.github/workflows/ci.yml' },
        ],
      },
    };
    assert({
      given: 'a self-modifying queue workflow',
      should: 'retain the independent CI evidence safeguard',
      actual: Boolean(verifyCiClaims([integration()], changed, proof).problem),
      expected: true,
    });
  });
});
