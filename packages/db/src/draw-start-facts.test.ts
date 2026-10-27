import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { RoomAssemblyState } from '@daisy/protocol';
import { fakeSql } from './scripted-bun-wire';
import { drawStartFacts } from './draw-start-facts';
import type { Tx } from './room-command-facts';

setupRitewayBun();

const human = (actorId: string) => ({ actorId, kind: 'human' as const });
const room = {
  executionPlan: {
    resolutionDraw: {
      enabled: true,
      drawSize: 3,
      strikeWindowMs: 60_000,
      firstStriker: 'negative',
      source: { kind: 'bank', categories: ['policy'] },
    },
  },
  participants: [human('a'), human('b'), human('c'), human('d')],
} as unknown as RoomAssemblyState;
const evidence = (bankEntryId: string) => ({
  items: [
    { position: 0, category: 'policy', bankEntryId: 'struck' },
    { position: 1, category: 'policy', bankEntryId },
  ],
  survivorPosition: 1,
});

test('a new draw reads every seated human’s recent choices in one query (PR #472 review)', async () => {
  const { client, queries } = fakeSql([
    [[1]],
    [['e1', 'Text', 'policy', 'en']],
    [[evidence('x')], [evidence('y')], [evidence('x')]],
  ]);
  const facts = await drawStartFacts(
    drizzle({ client }) as unknown as Tx,
    room,
  );
  assert({
    given: 'four seated humans and their recent Rounds',
    should:
      'exclude each debated bank entry once, read under the lock in a single query capped per actor',
    actual: {
      exclusions: [...facts.exclusions].sort(),
      recentQueries: queries.filter(({ query }) =>
        query.includes('round_participants'),
      ).length,
      boundedPerActor: queries.some(({ query }) =>
        /join lateral[\s\S]*limit/i.test(query),
      ),
    },
    expected: {
      exclusions: ['x', 'y'],
      recentQueries: 1,
      boundedPerActor: true,
    },
  });
});
