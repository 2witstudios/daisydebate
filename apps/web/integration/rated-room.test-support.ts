import { createId } from '@paralleldrive/cuid2';
import { createRatingSweep } from '../src/features/ratings/sweep';
import type { RatingLadder } from '@daisy/protocol';
import type { withRoomRuntime } from './room-runtime.test-support';
import { everyoneReady } from './round-judging.test-support';
import { strikeStanding } from './room-draw.test-support';
type Fixture = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];
/** Canonical setup proof; only the test-owned prep anchor advances, never real time. */
export async function readyRatedRoom(
  f: Fixture,
  ladder: RatingLadder,
  judgeKind: 'human' | 'ai',
) {
  const [preset] =
    await f.sql`select format_version,version from format_presets where format_id=${ladder} and superseded_at is null`;
  let room = await f.assemble({
    resolution:
      ladder === 'freestyle'
        ? { kind: 'strike' }
        : {
            kind: ladder,
            id:
              ladder === 'policy'
                ? 's3vycbr7v7fl6a2xzmgneize'
                : 'd3qrq2srlk8wpa3qhzefly0y',
          },
    selection: {
      kind: 'ranked',
      formatId: ladder,
      formatVersion: preset!.format_version,
      presetVersion: preset!.version,
    },
  });
  if (judgeKind === 'human')
    room = (
      await f.command(f.outsider, room, {
        type: 'claim-seat',
        role: 'judge',
        slot: 0,
      })
    ).view;
  else
    room = (
      await f.command(f.host, room, {
        type: 'assign-seat',
        role: 'judge',
        slot: 0,
        actorId: (await f.aiJudge()).actorId,
      })
    ).view;
  room = await everyoneReady(
    f,
    room,
    judgeKind === 'human' ? [f.host, f.guest, f.outsider] : [f.host, f.guest],
  );
  if (ladder === 'freestyle') {
    room = (await f.command(f.host, room, { type: 'start-pre-round' })).view;
    for (
      let ordinal = 0;
      ordinal < (room.resolutionDraw?.drawSize ?? 1) - 1;
      ordinal++
    ) {
      const who = ordinal % 2 === 0 ? f.guest : f.host;
      room = (
        await strikeStanding(
          f,
          await f.operations.view(who, room.id),
          who,
          ordinal,
        )
      ).view;
    }
    await f.sql`update rooms set prep_started_at=clock_timestamp()-interval '21 minutes' where id=${room.id}`;
    room = await f.operations.view(f.host, room.id);
  }
  return room;
}

/** Exercise duplicate delivery plus a fresh sweep over durable rating discovery. */
export async function recoverRatedResults(f: Fixture) {
  const sweep = () =>
    createRatingSweep({
      database: f.store,
      ids: { next: createId },
      onFailure: (_id, error) => {
        throw error;
      },
    })({ limit: 64 });
  await Promise.all([sweep(), sweep()]);
  await sweep();
}
