import {
  ballotCategories,
  ballotLimits,
  type JudgingFinish,
} from '@daisy/protocol';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { ballotInstructions } from './judge-instructions';
import { ballotWireSchema } from './judge-contract';
import { judgeAnswer } from './judge';

setupRitewayBun();

const scores = Object.fromEntries(ballotCategories.map((c) => [c, 3]));
const ballot = {
  rubricVersion: 'speaker-10@2',
  winner: 'negative',
  scores: { affirmative: scores, negative: scores },
  reason: 'The negative extended its contention.',
  feedback: { affirmative: 'Answer it.', negative: 'Signpost it.' },
};
const answer = (value: unknown) => ({
  text: typeof value === 'string' ? value : JSON.stringify(value),
  finish: 'stop' as JudgingFinish,
  refused: false,
});
const failure = (input: ReturnType<typeof answer>) => {
  const judged = judgeAnswer(input);
  if (judged.ok) throw new Error('expected a rejected answer');
  return judged.diagnostic;
};
type Wire = {
  properties: Record<string, Wire>;
  required: string[];
  additionalProperties: boolean;
  enum?: unknown[];
  description?: string;
  maxLength?: number;
};
const wire = ballotWireSchema as unknown as Wire;

describe('judge contract parity', () => {
  test('the prompt states the canonical limits', () => {
    assert({
      given: 'the judging instructions',
      should: 'state the reason and feedback limits from ballotLimits',
      actual: [ballotLimits.reason, ballotLimits.feedback].every((limit) =>
        ballotInstructions.includes(`${limit} characters`),
      ),
      expected: true,
    });
  });
  test('the wire schema derives from the ballot contract', () => {
    const score =
      wire.properties.scores!.properties.affirmative!.properties[
        ballotCategories[0]!
      ]!;
    assert({
      given: 'the wire schema',
      should: 'require every ballot field and refuse extras',
      actual: {
        required: [...wire.required].sort(),
        extras: wire.additionalProperties,
        scored: Object.keys(
          wire.properties.scores!.properties.negative!.properties,
        ).length,
        citations: 'citations' in wire.properties,
      },
      expected: {
        required: ['feedback', 'reason', 'rubricVersion', 'scores', 'winner'],
        extras: false,
        scored: ballotCategories.length,
        citations: false,
      },
    });
    assert({
      given: 'the whole wire schema',
      should: 'use no keyword strict endpoints refuse',
      actual: [
        'propertyNames',
        'maxLength',
        'minLength',
        'maximum',
        'minimum',
        '"const"',
        '$schema',
      ].filter((word) => JSON.stringify(ballotWireSchema).includes(word)),
      expected: [],
    });
    assert({
      given: 'a score',
      should: 'enumerate the whole scale, a keyword every endpoint supports',
      actual: score.enum,
      expected: [1, 2, 3, 4, 5],
    });
    assert({
      given: 'the bounded strings',
      should: 'carry the limit in the description, not an unsupported keyword',
      actual: {
        reason: wire.properties.reason!.description?.includes(
          `${ballotLimits.reason} characters`,
        ),
        feedback:
          wire.properties.feedback!.properties.affirmative!.description?.includes(
            `${ballotLimits.feedback} characters`,
          ),
        keyword: wire.properties.reason!.maxLength,
      },
      expected: { reason: true, feedback: true, keyword: undefined },
    });
  });
});

describe('judgeAnswer', () => {
  test('accepts boundary ballots and fenced JSON, never trimming', () => {
    const reason600 = { ...ballot, reason: 'x'.repeat(ballotLimits.reason) };
    const judged = judgeAnswer(
      answer('```json\n' + JSON.stringify(reason600) + '\n```'),
    );
    assert({
      given: `a fenced ballot with a ${ballotLimits.reason} character reason`,
      should: 'accept it unchanged',
      actual: judged.ok && judged.ballot.reason.length,
      expected: ballotLimits.reason,
    });
  });
  test('rejects with allowlisted facts only', () => {
    const secret = 'PRIVATE-DEBATE-TEXT';
    const tooLong = failure(
      answer({ ...ballot, reason: secret + 'x'.repeat(ballotLimits.reason) }),
    );
    assert({
      given: 'a reason one over the limit',
      should: 'name the field, code and limit',
      actual: tooLong,
      expected: {
        category: 'schema_rejected',
        finish: 'stop',
        issueCount: 1,
        issues: [
          { field: 'reason', code: 'too_big', limit: ballotLimits.reason },
        ],
      },
    });
    const extra = failure(answer({ ...ballot, [secret]: secret }));
    assert({
      given: 'an extra key named with private text',
      should: 'report the unknown marker and never the key',
      actual: {
        issue: extra.issues[0],
        leaked: JSON.stringify(extra).includes(secret),
      },
      expected: {
        issue: { field: 'unknown_field', code: 'unrecognized_keys' },
        leaked: false,
      },
    });
    const feedback = failure(
      answer({
        ...ballot,
        feedback: {
          ...ballot.feedback,
          negative: 'x'.repeat(ballotLimits.feedback + 1),
        },
      }),
    );
    assert({
      given: 'feedback one over the limit',
      should: 'name the side',
      actual: feedback.issues[0]?.field,
      expected: 'feedback.negative',
    });
    const missing = failure(
      answer({
        ...ballot,
        scores: { ...ballot.scores, affirmative: { ...scores, thesis: 6 } },
      }),
    );
    assert({
      given: 'a score over the scale',
      should: 'name the side and category',
      actual: missing.issues[0],
      expected: {
        field: 'scores.affirmative.thesis',
        code: 'too_big',
        limit: 5,
      },
    });
  });
  test('refuses what the old parser refused', () => {
    assert({
      given: 'a ballot naming no valid winner',
      should: 'reject the winner',
      actual: failure(answer({ ...ballot, winner: 'draw' })).issues[0]?.field,
      expected: 'winner',
    });
    const withoutThesis = Object.fromEntries(
      Object.entries(scores).filter(([category]) => category !== 'thesis'),
    );
    assert({
      given: 'a ballot missing a category score',
      should: 'name the missing score',
      actual: failure(
        answer({
          ...ballot,
          scores: { ...ballot.scores, affirmative: withoutThesis },
        }),
      ).issues[0]?.field,
      expected: 'scores.affirmative.thesis',
    });
  });
  test('classifies failures apart', () => {
    assert({
      given: 'text that is not JSON',
      should: 'be invalid_json with no issues',
      actual: failure(answer(`nope ${'secret'}`)),
      expected: {
        category: 'invalid_json',
        finish: 'stop',
        issueCount: 0,
        issues: [],
      },
    });
    assert({
      given: 'a cut-off answer',
      should: 'be truncated',
      actual: failure({ text: '{"winner":', finish: 'length', refused: false })
        .category,
      expected: 'truncated',
    });
    assert({
      given: 'a refusal',
      should: 'be refused even with parseable text',
      actual: failure({
        text: JSON.stringify(ballot),
        finish: 'stop',
        refused: true,
      }).category,
      expected: 'refused',
    });
    assert({
      given: 'a content filter stop',
      should: 'be refused',
      actual: failure({ text: '', finish: 'content_filter', refused: false })
        .category,
      expected: 'refused',
    });
  });
});
