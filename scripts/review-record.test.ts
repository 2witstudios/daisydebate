import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  declaredBuilder,
  linkedPageIds,
  verifyReviewRecord,
  type RecordPage,
} from './review-record';

setupRitewayBun();

const sha = 'a'.repeat(40);
const pr = { number: 57, headSha: sha, body: 'Builder: ag-builder\n' };
const record = (
  overrides: Partial<{
    title: string;
    candidate: string;
    verdict: string;
    gates: string;
  }> = {},
): RecordPage => ({
  id: 'rec1111111111111111111111',
  title: overrides.title ?? `Review record — GRD-6.1 (${sha})`,
  content: [
    '# Review: GRD-6.1 (pu/grd-6-autonomy)',
    overrides.candidate ??
      `Candidate: ${sha} · PR #57 · Builder: ag-builder · Reviewer: ag-reviewer`,
    '## Gates run',
    overrides.gates ??
      'bun check: PASS · bun test:integration: PASS · Negative control: guard rule removed, 6 tests failed',
    '## Findings',
    '- [x] minor · scripts/x.ts:1 · y · fixed in bbbbbbb',
    '## Verdict',
    overrides.verdict ?? '0 blocker / 0 major / 1 minor / 0 nit — ALL RESOLVED',
  ].join('\n'),
});

const url = 'https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha';

describe('linkedPageIds', () => {
  test('collects PageSpace page links from the PR body and comments', () => {
    assert({
      given: 'a body and comments linking two records, one twice',
      should: 'return each page id once, in order',
      actual: linkedPageIds([
        `Reviews: [record](${url}/rec1111111111111111111111) — ALL RESOLVED`,
        `see ${url}/rec2222222222222222222222 and ${url}/rec1111111111111111111111`,
      ]),
      expected: ['rec1111111111111111111111', 'rec2222222222222222222222'],
    });
  });
});

describe('declaredBuilder', () => {
  test('reads the builder the PR body declares', () => {
    assert({
      given: 'a PR body with and without a Builder line',
      should: 'return the id or undefined',
      actual: [
        declaredBuilder('## PageSpace\nBuilder: ag-za6fxjsn\n'),
        declaredBuilder('no builder'),
      ],
      expected: ['ag-za6fxjsn', undefined],
    });
  });
});

describe('verifyReviewRecord', () => {
  test('passes an independent approving record for the exact head SHA', () => {
    assert({
      given: 'a record for the head SHA by a reviewer who is not the builder',
      should: 'set review-record to success linking the record',
      actual: verifyReviewRecord(pr, [record()]),
      expected: {
        state: 'success',
        description: 'Independent review by ag-reviewer: ALL RESOLVED',
        recordId: 'rec1111111111111111111111',
      },
    });
  });

  test('stays pending until a record for this SHA exists', () => {
    assert({
      given: 'no records, and a record for an older SHA',
      should: 'be pending, never success',
      actual: [
        verifyReviewRecord(pr, []).state,
        verifyReviewRecord(pr, [
          record({
            title: `Review record — GRD-6.1 (${'b'.repeat(40)})`,
            candidate: `Candidate: ${'b'.repeat(40)} · PR #57 · Builder: ag-builder · Reviewer: ag-reviewer`,
          }),
        ]).state,
      ],
      expected: ['pending', 'pending'],
    });
  });

  test('refuses a record the builder minted for its own PR', () => {
    assert({
      given: 'a record whose reviewer is the declared builder',
      should: 'fail',
      actual: verifyReviewRecord(pr, [
        record({
          candidate: `Candidate: ${sha} · PR #57 · Builder: ag-builder · Reviewer: ag-builder`,
        }),
      ]),
      expected: {
        state: 'failure',
        description: 'The reviewer ag-builder is the builder of this PR',
        recordId: 'rec1111111111111111111111',
      },
    });
  });

  test('refuses records that do not bind this PR, builder and verdict', () => {
    const results = [
      verifyReviewRecord({ ...pr, body: 'no builder line' }, [record()]),
      verifyReviewRecord(pr, [
        record({
          candidate: `Candidate: ${sha} · PR #58 · Builder: ag-builder · Reviewer: ag-reviewer`,
        }),
      ]),
      verifyReviewRecord(pr, [
        record({
          candidate: `Candidate: ${sha} · PR #57 · Builder: ag-other · Reviewer: ag-reviewer`,
        }),
      ]),
      verifyReviewRecord(pr, [
        record({
          verdict: '1 blocker / 0 major / 0 minor / 0 nit — CHANGES REQUESTED',
        }),
      ]),
      verifyReviewRecord(pr, [record({ candidate: 'no candidate line' })]),
    ];
    assert({
      given:
        'no declared builder, another PR, another builder, changes requested, and no candidate line',
      should: 'fail each with its reason',
      actual: results.map((result) => [result.state, result.description]),
      expected: [
        ['failure', 'The PR body declares no "Builder: <id>" line'],
        ['failure', 'The record reviews PR #58, not #57'],
        [
          'failure',
          'The record names builder ag-other; the PR declares ag-builder',
        ],
        ['failure', 'The verdict is not an approval: CHANGES REQUESTED'],
        [
          'failure',
          'The record has no "Candidate: <sha> · PR #n · Builder: … · Reviewer: …" line',
        ],
      ],
    });
  });

  test('refuses a no-findings approval without integration tests and a negative control', () => {
    const clean = '0 blocker / 0 major / 0 minor / 0 nit — APPROVE';
    assert({
      given: 'a clean verdict with and without the required evidence',
      should: 'pass only when both were run',
      actual: [
        verifyReviewRecord(pr, [record({ verdict: clean })]).state,
        verifyReviewRecord(pr, [
          record({ verdict: clean, gates: 'bun check: PASS' }),
        ]).description,
      ],
      expected: [
        'success',
        'A no-findings verdict needs bun test:integration PASS and a negative control in Gates run',
      ],
    });
  });

  test('picks a passing record among several for the same SHA', () => {
    assert({
      given:
        'a first-pass CHANGES REQUESTED record and a second-pass ALL RESOLVED one',
      should: 'succeed from the second',
      actual: verifyReviewRecord(pr, [
        record({
          verdict: '1 blocker / 0 major / 0 minor / 0 nit — CHANGES REQUESTED',
        }),
        { ...record(), id: 'rec2222222222222222222222' },
      ]).recordId,
      expected: 'rec2222222222222222222222',
    });
  });
});
