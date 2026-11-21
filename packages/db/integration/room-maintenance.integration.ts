import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { maintainRoom } from '@daisy/debate-engine';
import { createId } from '@paralleldrive/cuid2';
import { buildRoomTopic } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withDatabase, withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('idle maintenance skips a locked Room, then closes it and clears its Challenge', async () => {
  await withFixture(url, async (fixture) => {
    const host = await fixture.actor();
    const challenger = await fixture.actor();
    const roomId = await fixture.room(host, await fixture.format(), {
      execution_plan: {
        preRoundPrep: { enabled: false },
        resolutionDraw: { enabled: false },
      },
    });
    const challengeId = createId();
    const roomTopic = buildRoomTopic(roomId);
    const [idle] =
      await fixture.sql`update rooms set last_command_at = statement_timestamp() - interval '11 minutes' where id=${roomId} returning last_command_at`;
    await fixture.insert('challenges', {
      id: challengeId,
      challenger_actor_id: challenger,
      challenged_actor_id: host,
      mode: 'casual',
      format_id: 'freestyle',
      division: 'open',
      room_id: roomId,
      created_at: new Date(),
      expires_at: new Date('2099-01-01'),
      follow_until: new Date('2099-01-01'),
    });
    try {
      await withDatabase(url, async (database) => {
        await assertRejects({
          given: 'a zero timeout',
          should: 'refuse invalid maintenance policy',
          actual: () =>
            database.readMaintenanceCandidates({ idleTimeoutMs: 0, limit: 64 }),
          code: 'VALIDATION',
        });
        const candidates = await database.readMaintenanceCandidates({
          idleTimeoutMs: 600_000,
          limit: 64,
        });
        const decisions: string[] = [];
        const keep = () =>
          database.maintainRoom({
            roomId,
            maintain: (_state, facts) => {
              decisions.push(facts.lastCommandAt);
              return null;
            },
          });
        const skipped = await fixture.sql.begin(async (tx) => {
          await tx`select id from rooms where id=${roomId} for update`;
          return keep();
        });
        const kept = await keep();
        const [before] =
          await fixture.sql`select status from rooms where id=${roomId}`;
        const expired = await database.maintainRoom({
          roomId,
          maintain: (state, facts) =>
            maintainRoom(state, { ...facts, idleTimeoutMs: 600_000 }),
        });
        const [after] =
          await fixture.sql`select status from rooms where id=${roomId}`;
        assert({
          given:
            'the same idle Room under a competing lock, a keep-open ruling, and an expiry ruling',
          should:
            'discover by database time, skip the held row, preserve the kept Room and then close once with an outbox change',
          actual: [
            candidates.includes(roomId),
            skipped,
            kept,
            decisions,
            before?.status,
            expired,
            after?.status,
            await fixture.count('challenges', 'id', challengeId),
            await fixture.count('outbox', 'topic', roomTopic),
          ],
          expected: [
            true,
            false,
            false,
            [idle?.last_command_at?.toISOString()],
            'assembling',
            true,
            'closed',
            0,
            1,
          ],
        });
      });
    } finally {
      await fixture.sql`delete from outbox where topic = ${roomTopic}`;
    }
  });
});
