import type { RoundCoachingFacts } from '@daisy/db/rounds';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  claimDecision,
  coachingNeeded,
  coachingPolicy,
  coachingView,
} from './policy';

setupRitewayBun();

const completedAt = '2026-10-26T12:00:00.000Z';
const at = (ms: number) => new Date(Date.parse(completedAt) + ms).toISOString();
const window = coachingPolicy.windowMs;
/** A human-judged Round that completed with frozen lines and no pass yet. */
const facts = (
  overrides: Partial<RoundCoachingFacts> = {},
): RoundCoachingFacts => ({
  status: 'completed',
  completedAt,
  frozen: true,
  lines: 4,
  aiBallots: [],
  pass: null,
  ...overrides,
});
const leased = (attempts: number, expiresInMs: number) =>
  ({
    status: 'leased',
    attempts,
    leaseExpiresAt: at(expiresInMs),
    feedback: null,
  }) as const;

describe('coachingNeeded()', () => {
  test('the window', () => {
    assert({
      given: 'a human-judged Round just inside, at, and past 24 hours',
      should: 'need coaching only strictly inside the window',
      actual: [window - 1, window, window + 1].map((ms) =>
        coachingNeeded(facts(), at(ms)),
      ),
      expected: [true, false, false],
    });
  });
  test('the evidence', () => {
    assert({
      given:
        'a Round with no freeze, a freeze with no lines, one not completed, and one with no completion time',
      should: 'need no coaching: there is nothing to coach from',
      actual: [
        facts({ frozen: false }),
        facts({ lines: 0 }),
        facts({ status: 'active' }),
        facts({ completedAt: null }),
      ].map((f) => coachingNeeded(f, at(1))),
      expected: [false, false, false, false],
    });
  });
  test('the AI judge’s ballot', () => {
    const ai = (submitted: boolean, sides: ('affirmative' | 'negative')[]) =>
      facts({ aiBallots: [{ submitted, sides }] });
    assert({
      given:
        'an AI ballot that coached both sides, one that coached one side, and a voided one that coached both',
      should: 'need no pass only when a submitted AI ballot coached both sides',
      actual: [
        ai(true, ['affirmative', 'negative']),
        ai(true, ['negative']),
        ai(false, ['affirmative', 'negative']),
      ].map((f) => coachingNeeded(f, at(1))),
      expected: [false, true, true],
    });
  });
});

describe('claimDecision()', () => {
  test('a Round with no pass', () => {
    assert({
      given: 'a Round that needs coaching, then one that does not',
      should: 'claim the first and leave the second',
      actual: [
        claimDecision(facts(), at(1)),
        claimDecision(facts({ lines: 0 }), at(1)),
      ],
      expected: ['claim', 'skip'],
    });
  });
  test('a held lease', () => {
    assert({
      given: 'a lease still held, and a finished pass',
      should: 'leave both alone',
      actual: [
        claimDecision(facts({ pass: leased(1, 60_000) }), at(1)),
        claimDecision(
          facts({
            pass: {
              status: 'succeeded',
              attempts: 1,
              leaseExpiresAt: null,
              feedback: { affirmative: 'A.', negative: 'N.' },
            },
          }),
          at(1),
        ),
      ],
      expected: ['skip', 'skip'],
    });
  });
  test('a lapsed lease', () => {
    assert({
      given:
        'a lapsed first attempt, a lapsed attempt at the cap, and a lapsed first attempt after the window',
      should:
        'retake the first, and end the spent one and the one that is no longer needed',
      actual: [
        claimDecision(facts({ pass: leased(1, 1000) }), at(2000)),
        claimDecision(
          facts({ pass: leased(coachingPolicy.maxCalls, 1000) }),
          at(2000),
        ),
        claimDecision(facts({ pass: leased(1, window) }), at(window + 1)),
      ],
      expected: ['claim', 'fail', 'fail'],
    });
  });
});

describe('coachingView()', () => {
  const view = (
    f: RoundCoachingFacts,
    side: 'affirmative' | 'negative' = 'negative',
    enabled = true,
  ) => coachingView({ facts: f, side, now: at(1000), enabled });
  test('the AI judge coached this side', () => {
    const partial = facts({
      aiBallots: [{ submitted: true, sides: ['negative'] }],
    });
    assert({
      given: 'an AI ballot that coached only the negative',
      should:
        'point the negative to that ballot and keep the affirmative waiting for the pass',
      actual: [view(partial, 'negative'), view(partial, 'affirmative')],
      expected: [{ status: 'in-ballot' }, { status: 'pending' }],
    });
  });
  test('the pass', () => {
    assert({
      given:
        'a succeeded pass, one leased, one leased but lapsed at the cap, and one failed',
      should: 'show the side’s text, pending, unavailable, and unavailable',
      actual: [
        view(
          facts({
            pass: {
              status: 'succeeded',
              attempts: 1,
              leaseExpiresAt: null,
              feedback: { affirmative: 'A.', negative: 'Weigh the turn.' },
            },
          }),
        ),
        view(facts({ pass: leased(1, 60_000) })),
        view(facts({ pass: leased(coachingPolicy.maxCalls, 0) })),
        view(
          facts({
            pass: {
              status: 'failed',
              attempts: 2,
              leaseExpiresAt: null,
              feedback: null,
            },
          }),
        ),
      ],
      expected: [
        { status: 'ready', text: 'Weigh the turn.' },
        { status: 'pending' },
        { status: 'unavailable' },
        { status: 'unavailable' },
      ],
    });
  });
  test('no pass yet', () => {
    assert({
      given:
        'a Round needing coaching with coaching on, then off, then one with no transcript, then one still in progress',
      should:
        'be pending only when the pass will run, and absent before completion',
      actual: [
        view(facts()),
        view(facts(), 'negative', false),
        view(facts({ frozen: false })),
        view(facts({ status: 'active' })),
      ],
      expected: [
        { status: 'pending' },
        { status: 'unavailable' },
        { status: 'unavailable' },
        null,
      ],
    });
  });
});
