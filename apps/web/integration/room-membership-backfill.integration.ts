import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  launchRuntimeRound,
  withRoomRuntime,
} from './round-runtime.test-support';
setupRitewayBun();
requireTestServices(process.env);

/** The one-active-Room migration's backfill statement, exactly as committed. */
const backfill = async () => {
  const migration = await Bun.file(
    new URL(
      '../../../packages/db/migrations/20261026154930_one_active_room/migration.sql',
      import.meta.url,
    ),
  ).text();
  const statement = migration.split('--> statement-breakpoint').at(-1)!;
  if (!statement.includes('INSERT INTO "room_active_memberships"'))
    throw new Error('The migration no longer ends with its backfill');
  return statement;
};
class RolledBack extends Error {}

test('the migration backfill holds open and speaking Rooms only, as the engine rules (ADR 0070)', async () => {
  await withRoomRuntime(async (f) => {
    const open = await f.freshCast();
    const openRoom = (await f.create({}, open.host)).view;
    const launched = async (state: string) => {
      const cast = await f.freshCast();
      const { roundId } = await launchRuntimeRound(
        f,
        await f.assemble({}, cast),
      );
      if (state !== 'scheduled') await f.sql.unsafe(state, [roundId]);
      return { cast, roundId };
    };
    const speaking = await launched(
      `update rounds set status='active',current_stage='countdown',started_at=statement_timestamp() where id=$1`,
    );
    const awaitingBallots = await launched(
      `update rounds set status='active',current_stage='countdown',started_at=statement_timestamp(),final_segment_ended_at=statement_timestamp(),transcript_admission_cutoff=statement_timestamp()+interval '120 seconds' where id=$1`,
    );
    const abandoned = await launched(
      `update rounds set status='abandoned',completed_at=statement_timestamp() where id=$1`,
    );
    const scheduled = await launched('scheduled');
    const actors = [
      open,
      speaking.cast,
      awaitingBallots.cast,
      abandoned.cast,
      scheduled.cast,
    ].flatMap((cast) => [cast.host.actorId, cast.guest.actorId]);
    const statement = await backfill();
    let held: { actor_id: string }[] = [];
    try {
      await f.sql.begin(async (tx) => {
        await tx`delete from room_active_memberships where actor_id in ${tx(actors)}`;
        await tx.unsafe(statement);
        held =
          await tx`select actor_id from room_active_memberships where actor_id in ${tx(actors)}`;
        throw new RolledBack();
      });
    } catch (error) {
      if (!(error instanceof RolledBack)) throw error;
    }
    const heldIds = new Set(held.map((row) => row.actor_id));
    const holds = (cast: {
      host: { actorId: string };
      guest: { actorId: string };
    }) => [cast.host.actorId, cast.guest.actorId].map((id) => heldIds.has(id));
    assert({
      given:
        'an open Room, and launched Rounds scheduled, speaking, awaiting ballots and abandoned',
      should: 'backfill members for the open, scheduled and speaking ones only',
      actual: {
        open: heldIds.has(open.host.actorId),
        scheduled: holds(scheduled.cast),
        speaking: holds(speaking.cast),
        awaitingBallots: holds(awaitingBallots.cast),
        abandoned: holds(abandoned.cast),
        openRoom: openRoom.status,
      },
      expected: {
        open: true,
        scheduled: [true, true],
        speaking: [true, true],
        awaitingBallots: [false, false],
        abandoned: [false, false],
        openRoom: 'assembling',
      },
    });
  });
});
