import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  ciRun,
  evidence,
  integration,
  judge,
  runtimePr,
} from './review-ci.test-support';

setupRitewayBun();

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

test('CI creation facts must be canonical UTC instants, not normalized invalid dates', () => {
  assert({
    given: 'a future impossible calendar date or a bare future year',
    should:
      'refuse the malformed provenance rather than normalize it into an accepted later run',
    actual: ['2027-02-30T12:00:00Z', '2040'].map((createdAt) =>
      judge(integration(), evidence(ciRun({ createdAt }))),
    ),
    expected: [0, 1].map(
      () =>
        'CI run 101 or PR #57 has no valid creation time, so its PR provenance cannot be verified',
    ),
  });
});
