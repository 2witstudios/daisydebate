import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readRatingCandidates, readRatingFacts } from './rating-discovery';

setupRitewayBun();

const row = (roundId: string, adjudications: readonly unknown[]) => ({
  roundId,
  competitionType: 'ranked',
  ladderId: 'freestyle',
  status: 'completed',
  outcome: 'affirmative',
  completedAt: null,
  alreadyRated: false,
  ending: null,
  ruleSegments: [],
  speeches: [],
  adjudications,
  receipts: [],
  pendingWriter: false,
});
const corrupt = { segmentId: 'a', evidence: 'guess', decision: 'attended' };
const database = (rows: readonly unknown[]) =>
  ({ execute: async () => rows }) as unknown as Parameters<
    typeof readRatingCandidates
  >[0];

test('one corrupt ledger row fails alone', async () => {
  const page = await readRatingCandidates(
    database([row('bad', [corrupt]), row('good', [])]),
    { limit: 2 },
  );
  assert({
    given: 'a page holding one row outside its evidence shape',
    should: 'read the other Round, and name the bad one unreadable',
    actual: page.map(({ roundId, facts }) => [roundId, facts !== null]),
    expected: [
      ['bad', false],
      ['good', true],
    ],
  });
  await assertRejects({
    given: 'that row read on its own',
    should: 'refuse it as corruption',
    actual: () =>
      readRatingFacts(database([row('bad', [corrupt])]), 'b'.repeat(24)),
    code: 'INVARIANT',
  });
});
