import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { buildDebateTopic } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createDatabase } from '../src';
import { withFixture } from './constraint-helpers';
setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('segment-only projection commits the same revision as event and command receipt', async () => {
  await withFixture(url, async (fixture) => {
    const roundId = await fixture.round({
      status: 'active',
      current_stage: 'live',
      started_at: new Date('2026-10-06T09:00:00.000Z'),
    });
    const database = createDatabase({ url, nextActorId: createId });
    const commandId = createId();
    try {
      const before = await database.getRound(roundId);
      if (!before) throw new Error('Round missing');
      const first = before.rules.segments[0]!;
      await database.applyRoundExecution({
        roundId,
        expectedVersion: 1,
        command: {
          commandId,
          actorId: null,
          serviceId: 'integration',
          type: 'start_speech',
          payloadDigest: 'a'.repeat(64),
          result: { ok: true },
        },
        buildProjection: (now) => ({
          round: null,
          segmentInserts: [
            {
              id: createId(),
              sequence: 0,
              type: first.type,
              rulesSegmentKey: first.key,
              durationMs: first.durationMs,
              startedAt: now,
            },
          ],
          segmentCloses: [],
          effects: [],
        }),
      });
      await database.applyRoundExecution({
        roundId,
        expectedVersion: 2,
        command: null,
        buildProjection: () => ({
          round: null,
          segmentInserts: [],
          segmentCloses: [],
          effects: [],
        }),
      });
      const [receipt] = await fixture.sql.unsafe(
        'select resulting_version from round_commands where command_id = $1',
        [commandId],
      );
      const events = await fixture.sql.unsafe(
        'select payload from outbox where topic = $1 order by seq',
        [buildDebateTopic(roundId)],
      );
      assert({
        given: 'segment-only insert followed by true no-op',
        should: 'persist exactly one revision matching its receipt and event',
        actual: {
          version: (await database.getRound(roundId))?.version,
          receipt: receipt.resulting_version,
          events: events.map(
            (row: { payload: { entityVersion: number } }) =>
              row.payload.entityVersion,
          ),
        },
        expected: { version: 2, receipt: 2, events: [2] },
      });
    } finally {
      await database.close();
    }
  });
});
