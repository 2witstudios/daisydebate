import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import type { RatingEligibilityFacts } from '@daisy/protocol';
import { createRatingSweep } from './sweep';

setupRitewayBun();

const rateable: RatingEligibilityFacts = {
  competitionType: 'ranked',
  ladderId: 'freestyle',
  status: 'completed',
  outcome: 'affirmative',
  completedAt: '2026-10-05T12:00:00.000Z',
  alreadyRated: false,
  ending: 'forfeit',
  attendance: {
    ruleSegments: [],
    speeches: [],
    adjudications: [],
    receipts: [],
    pendingWriter: false,
  },
};

test('rating recovery advances past failures and retries them on the next bounded scan', async () => {
  const attempts: string[] = [];
  const failures: string[] = [];
  const sweep = createRatingSweep({
    ids: { next: () => 'ledger-id' },
    database: {
      readRatingCandidates: async () => [
        { roundId: 'blocked', facts: rateable },
        { roundId: 'ready', facts: rateable },
      ],
      rateRound: async ({ roundId }) => {
        attempts.push(roundId);
        if (roundId === 'blocked')
          throw createAppError('CONFLICT', 'No season is active');
        return { kind: 'already-rated' };
      },
    },
    onFailure: (roundId, _error) => {
      failures.push(roundId);
    },
  });
  const page = await sweep({ limit: 2 });
  await sweep({ limit: 2 });
  assert({
    given:
      'one failed posting before an eligible result in a full recovery page',
    should:
      'attempt later results, retain scan progress and retry failures next pass',
    actual: { attempts, failures, page },
    expected: {
      attempts: ['blocked', 'ready', 'blocked', 'ready'],
      failures: ['blocked', 'blocked'],
      page: { afterId: 'ready', exhausted: false },
    },
  });
});

test("rating recovery leaves the engine's unrated Rounds alone and still pages past them", async () => {
  const attempts: string[] = [];
  const page = await createRatingSweep({
    ids: { next: () => 'ledger-id' },
    database: {
      readRatingCandidates: async () => [
        {
          roundId: 'unjudged',
          facts: { ...rateable, ending: 'unjudged' },
        },
        { roundId: 'no-result', facts: { ...rateable, outcome: null } },
      ],
      rateRound: async ({ roundId }) => {
        attempts.push(roundId);
        return { kind: 'already-rated' };
      },
    },
    onFailure: () => {},
  })({ limit: 2 });
  assert({
    given: 'a full page of candidates the engine leaves unrated',
    should: 'rate none and advance the cursor rather than report exhaustion',
    actual: { attempts, page },
    expected: {
      attempts: [],
      page: { afterId: 'no-result', exhausted: false },
    },
  });
});

test('rating recovery reports a Round whose facts cannot be decided and pages on', async () => {
  const attempts: string[] = [];
  const failures: string[] = [];
  const page = await createRatingSweep({
    ids: { next: () => 'ledger-id' },
    database: {
      readRatingCandidates: async () => [
        {
          roundId: 'corrupt',
          facts: {
            ...rateable,
            ending: 'judged',
            attendance: {
              ...rateable.attendance,
              ruleSegments: null as never,
            },
          },
        },
        { roundId: 'ready', facts: rateable },
      ],
      rateRound: async ({ roundId }) => {
        attempts.push(roundId);
        return { kind: 'already-rated' };
      },
    },
    onFailure: (roundId) => {
      failures.push(roundId);
    },
  })({ limit: 2 });
  assert({
    given: 'one candidate whose stored facts make the decision throw',
    should: 'report that Round and still rate the rest of the page',
    actual: { attempts, failures, page },
    expected: {
      attempts: ['ready'],
      failures: ['corrupt'],
      page: { afterId: 'ready', exhausted: false },
    },
  });
});
