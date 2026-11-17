import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  launchRuntimeRound,
  withRoomRuntime,
} from './round-runtime.test-support';
setupRitewayBun();
requireTestServices(process.env);

const migrationText = (folder: string) =>
  Bun.file(
    new URL(
      `../../../packages/db/migrations/${folder}/migration.sql`,
      import.meta.url,
    ),
  ).text();

/**
 * The one-active-Room migration's backfill statement, exactly as committed,
 * on the table TAB-6 renamed, followed by TAB-6's own release of every held
 * row without a seat: together, what a database migrated today holds.
 */
const backfill = async () => {
  const statement = (await migrationText('20261026154930_one_active_room'))
    .split('--> statement-breakpoint')
    .at(-1)!;
  if (!statement.includes('INSERT INTO "room_active_memberships"'))
    throw new Error('The migration no longer ends with its backfill');
  const seatless = (await migrationText('20261117033253_tab_seats'))
    .split('--> statement-breakpoint')
    .find((part) => part.trim().startsWith('DELETE FROM "active_seats" s'));
  if (!seatless) throw new Error('TAB-6 no longer releases seatless holds');
  return [
    statement.replaceAll('"room_active_memberships"', '"active_seats"'),
    seatless,
  ];
};
class RolledBack extends Error {}

test('the migration backfill holds open and speaking Rooms only, as the engine rules (ADR 0070)', async () => {
  await withRoomRuntime(async (f) => {
    const open = await f.freshCast();
    const created = (await f.create({}, open.host)).view;
    // A seat is what holds a person (TAB-6): the open Room's host takes one.
    const openRoom = (
      await f.command(open.host, created, {
        type: 'claim-seat',
        seat: { kind: 'side', side: 'affirmative', slot: 0 },
      })
    ).view;
    const launched = async (state: string) => {
      const cast = await f.freshCast();
      const { roundId } = await launchRuntimeRound(
        f,
        await f.assemble({}, cast),
      );
      if (state !== 'opening') await f.sql.unsafe(state, [roundId]);
      return { cast, roundId };
    };
    const speaking = await launched(
      `update rounds set status='active',current_stage='countdown',started_at=statement_timestamp() where id=$1`,
    );
    const awaitingBallots = await launched(
      `update rounds set status='active',current_stage='countdown',started_at=statement_timestamp(),final_segment_ended_at=statement_timestamp(),transcript_admission_cutoff=statement_timestamp()+interval '120 seconds',attendance_resolution_cutoff_at=statement_timestamp()+interval '60 minutes' where id=$1`,
    );
    const abandoned = await launched(
      `update rounds set status='abandoned',current_stage=null,completed_at=statement_timestamp() where id=$1`,
    );
    const scheduled = await launched('opening');
    const actors = [
      open,
      speaking.cast,
      awaitingBallots.cast,
      abandoned.cast,
      scheduled.cast,
    ].flatMap((cast) => [cast.host.actorId, cast.guest.actorId]);
    const statements = await backfill();
    let held: { actor_id: string }[] = [];
    try {
      await f.sql.begin(async (tx) => {
        await tx`delete from active_seats where actor_id in ${tx(actors)}`;
        for (const statement of statements) await tx.unsafe(statement);
        held =
          await tx`select actor_id from active_seats where actor_id in ${tx(actors)}`;
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
