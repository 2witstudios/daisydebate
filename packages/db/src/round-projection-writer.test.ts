import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { emptyRuntimeCheckpoint, type RoundProjection } from '@daisy/protocol';
import { fakeSql, type ScriptedResult } from './scripted-bun-wire';
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
  runtimeState: emptyRuntimeCheckpoint,
};
const projection = (releases: boolean): RoundProjection => ({
  ...(releases ? { releasesRoomMembers: true as const } : {}),
  round: null,
  segmentInserts: [],
  segmentCloses: [
    { id: 'c9b8a7d6e5f4h3j2k1m9n8p7', endedAt: '2026-10-09T00:02:00.000Z' },
  ],
  effects: [],
});
const releases = async (ruled: boolean) => {
  // Round row and segment close, then (when ruled) the release, then the doorbell.
  const writes: ScriptedResult[] = ruled ? [[], [], []] : [[], []];
  const { client, queries } = fakeSql([
    ...writes,
    [[1n, '42']] as ScriptedResult,
    [],
  ]);
  await writeProjectionWithPhaseSignal(
    drizzle({ client }),
    roundId,
    current,
    projection(ruled),
    '2026-10-09T00:02:00.000Z',
  );
  return queries.some(({ query }) =>
    query.startsWith('delete from "room_active_memberships"'),
  );
};

test('the writer persists the engine release ruling and nothing else (ADR 0070)', async () => {
  assert({
    given: 'a revision the engine does not rule a release on, then one it does',
    should: 'release the Room memberships only when ruled',
    actual: [await releases(false), await releases(true)],
    expected: [false, true],
  });
});
