import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { noopErrorReporter } from '@daisy/observability';
import { createId } from '@paralleldrive/cuid2';
import type { SQL } from 'bun';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createRoundRuntimeOperations } from '../src/features/round-runtime/operations';
import { readAudienceSnapshot } from '../src/features/spectating/read-timeline';
import { silentLogger } from '../src/server/test-loggers.test-support';
import { withAttendanceRound } from './attendance.test-support';
import { withMediaRound } from './round-media.test-support';

setupRitewayBun();
requireTestServices(process.env);

/** Every record that would make this actor part of the Round or its Room. */
const participationRows = async (sql: SQL, actorId: string) => {
  const [round] =
    await sql`select count(*)::int as n from round_participants where actor_id=${actorId}`;
  const [room] =
    await sql`select count(*)::int as n from room_participants where actor_id=${actorId}`;
  const [member] =
    await sql`select count(*)::int as n from room_active_memberships where actor_id=${actorId}`;
  return [round!.n, room!.n, member!.n];
};

test('a spectator holds no Ready, command or attendance power, and watching records no seat', async () => {
  await withAttendanceRound(async ({ f, attendance, roundId, segmentId }) => {
    const spectator = await f.member();
    const [row] = await f.sql`select room_id from rounds where id=${roundId}`;
    const roomId = row!.room_id as string;
    const round = await f.store.getRound(roundId);
    const debaterSeat = round!.participants.find(
      (seat) => seat.role === 'affirmative',
    )!.id;
    const room = await f.operations.view(spectator, roomId);
    const [{ n: receiptsBefore }] =
      await f.sql`select count(*)::int as n from round_check_ins where round_id=${roundId}`;
    const commandsBefore =
      await f.sql`select count(*)::int as n from round_commands where round_id=${roundId}`;

    const timeline = await readAudienceSnapshot(f.store, {
      roundId,
      now: new Date().toISOString(),
      feedUrlOf: () => null,
    });
    assert({
      given: 'the live public Round watched by a signed-in spectator',
      should: 'answer the released facts, the one read a spectator has',
      actual: timeline?.timeline.roundId,
      expected: roundId,
    });
    await assertRejects({
      given: 'Ready sent to the started Room by a spectator',
      should: 'refuse it: Ready belongs to a seat',
      actual: () =>
        f.operations.command(spectator, roomId, {
          commandId: createId(),
          expectedVersion: room.version,
          type: 'ready',
          expectedConsentVersion: 1,
        }),
      code: 'AUTHORIZATION',
    });
    await assertRejects({
      given: 'a seat claimed in the started Room by a spectator',
      should: 'refuse it as a closed Room',
      actual: () =>
        f.operations.command(spectator, roomId, {
          commandId: createId(),
          expectedVersion: room.version,
          type: 'claim-seat',
          role: 'judge',
          slot: 0,
        }),
      code: 'CONFLICT',
    });
    await assertRejects({
      given: "a forfeit of a debater's seat sent by a spectator",
      should: 'refuse it',
      actual: () =>
        createRoundRuntimeOperations({
          store: f.store,
          nextSegmentId: createId,
        }).command({ kind: 'human', actorId: spectator.actorId }, roundId, {
          version: 1,
          commandId: createId(),
          expectedVersion: round!.version,
          command: { type: 'forfeit', participantId: debaterSeat },
        }),
      code: 'AUTHORIZATION',
    });
    await assertRejects({
      given: 'an attendance check-in sent by a spectator',
      should: 'refuse it',
      actual: () =>
        attendance.checkIn(
          { kind: 'human', actorId: spectator.actorId },
          roundId,
          { version: 1, commandId: createId(), segmentId },
        ),
      code: 'AUTHORIZATION',
    });
    assert({
      given: 'every one of those refused, after the spectator watched',
      should: 'leave no seat or membership for them',
      actual: await participationRows(f.sql, spectator.actorId),
      expected: [0, 0, 0],
    });
    assert({
      given: 'the refused check-in',
      should:
        'credit no attendance: its write marker is aborted and no receipt exists',
      actual: {
        attempts: (
          await f.sql`select state from round_check_in_attempts where actor_id=${spectator.actorId}`
        ).map((attempt: { state: string }) => attempt.state),
        receipts: (
          await f.sql`select count(*)::int as n from round_check_ins where round_id=${roundId}`
        )[0].n,
      },
      expected: { attempts: ['aborted'], receipts: receiptsBefore },
    });
    assert({
      given: 'the Round after the refused command',
      should: 'carry no command from the spectator',
      actual:
        await f.sql`select count(*)::int as n from round_commands where round_id=${roundId}`,
      expected: commandsBefore,
    });
  });
});

test('a spectator gets no media token, so no publish, and no record from asking', async () => {
  await withMediaRound(async (f) => {
    const spectator = await f.member();
    await assertRejects({
      given: 'a media session asked for by a spectator',
      should: 'refuse before any token exists, so nothing can publish',
      actual: () => f.mediaOperations.session(f.roundId, spectator.actorId),
      code: 'AUTHORIZATION',
    });
    assert({
      given: 'the refused media session',
      should: 'leave no seat or membership',
      actual: await participationRows(f.sql, spectator.actorId),
      expected: [0, 0, 0],
    });
  });
});
