import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  judgingAttemptDiagnosticSchema,
  judgingBallotFields,
} from './round-judging-attempt';

setupRitewayBun();

const diagnostic = {
  category: 'schema_rejected',
  finish: 'stop',
  issueCount: 1,
  issues: [{ field: 'reason', code: 'too_big', limit: 600 }],
};

describe('judging attempt diagnostic', () => {
  test('carries only allowlisted facts', () => {
    assert({
      given: 'a bounded diagnostic of canonical fields',
      should: 'parse',
      actual: judgingAttemptDiagnosticSchema.safeParse(diagnostic).success,
      expected: true,
    });
    const refused: [string, unknown][] = [
      ['a raw message', { ...diagnostic, message: 'model said' }],
      [
        'a field outside the ballot',
        { ...diagnostic, issues: [{ field: 'transcript', code: 'too_big' }] },
      ],
      [
        'a received value on an issue',
        {
          ...diagnostic,
          issues: [{ field: 'reason', code: 'too_big', received: 'private' }],
        },
      ],
      ['an unknown category', { ...diagnostic, category: 'mystery' }],
      [
        'more issues than the bound',
        {
          ...diagnostic,
          issues: Array.from({ length: 17 }, () => diagnostic.issues[0]),
        },
      ],
    ];
    for (const [given, value] of refused)
      assert({
        given,
        should: 'refuse',
        actual: judgingAttemptDiagnosticSchema.safeParse(value).success,
        expected: false,
      });
  });
  test('names every scored field', () => {
    assert({
      given: 'the ballot contract',
      should: 'allowlist a per-side score path and the unknown marker',
      actual: ['scores.negative.thesis', 'unknown_field'].every((field) =>
        (judgingBallotFields as readonly string[]).includes(field),
      ),
      expected: true,
    });
  });
});
