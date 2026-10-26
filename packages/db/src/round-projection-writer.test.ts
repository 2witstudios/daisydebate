import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { RoundProjection } from '@daisy/protocol';
import { fakeSql } from './scripted-bun-wire';
import { writeProjectionWithPhaseSignal } from './round-projection-writer';

setupRitewayBun();

const roundId = 'c3a1d5f7h9j2k4m6n8p1r3t5';
const current = {
  version: 4,
  status: 'active' as const,
  currentStage: null,
  startedAt: new Date('2026-10-09T00:00:00.000Z'),
  completedAt: null,
  outcome: null,
  runtimeState: null,
};
const projection = (
  finalSegmentEndedAt: string | undefined,
): RoundProjection => ({
  ...(finalSegmentEndedAt === undefined ? {} : { finalSegmentEndedAt }),
  round: null,
  segmentInserts: [],
  segmentCloses: [
    { id: 'c9b8a7d6e5f4h3j2k1m9n8p7', endedAt: '2026-10-09T00:02:00.000Z' },
  ],
  effects: [],
});
const releases = async (finalSegmentEndedAt: string | undefined) => {
  // Round row, segment close, then (final only) release and cutoff, then the doorbell.
  const writes: unknown[][] =
    finalSegmentEndedAt === undefined ? [[], []] : [[], [], [], []];
  const { client, queries } = fakeSql([...writes, [[1n, '42']], []]);
  await writeProjectionWithPhaseSignal(
    drizzle({ client }),
    roundId,
    current,
    projection(finalSegmentEndedAt),
    '2026-10-09T00:02:00.000Z',
  );
  return queries.some(({ query }) =>
    query.startsWith('delete from "room_active_memberships"'),
  );
};

test('the last speech ending frees the Room members; an earlier speech does not (ADR 0070)', async () => {
  assert({
    given:
      'an active Round closing a middle speech, then one closing its final speech',
    should: 'release the Room memberships only once the debate is over',
    actual: [
      await releases(undefined),
      await releases('2026-10-09T00:02:00.000Z'),
    ],
    expected: [false, true],
  });
});
