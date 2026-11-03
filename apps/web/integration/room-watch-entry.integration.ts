import { requireTestServices } from '@daisy/config';
import { RANKED_DELAY_SECONDS } from '@daisy/debate-engine';
import { SPECTATOR_MARGIN_MS } from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { spectatorClockAt } from '../src/features/spectating/spectator-clock';
import {
  launchRuntimeRound,
  withRoomRuntime,
} from './round-runtime.test-support';

setupRitewayBun();
requireTestServices(process.env);

test('a Room link reaches Watch only once the timeline has released the start', async () => {
  await withRoomRuntime(async (f) => {
    const cast = await f.freshCast();
    const room = await f.assemble({}, cast);
    const { roundId } = await launchRuntimeRound(f, room);
    const spectator = await f.member();
    const [row] =
      (await f.sql`select started_at from rounds where id=${roundId}`) as {
        started_at: Date;
      }[];
    const startedAt = row!.started_at;
    const delayed = {
      kind: 'delay',
      seconds: RANKED_DELAY_SECONDS,
    };
    await f.sql`insert into broadcasts (id, round_id, feed_key, release_policy)
      values (${createId()}, ${roundId}, ${createId()}, ${delayed})`;
    try {
      const outside = () => f.operations.view(spectator, room.id);
      const anyone = (at: Date) =>
        f.store.readWatchableRoundOfRoom(
          room.id,
          spectatorClockAt(at.toISOString()),
        );
      const later = new Date(startedAt.getTime() + 3_600_000);
      const before = await outside();
      assert({
        given: 'a started public Room, nothing released, read from outside',
        should: 'stay closed with no way to Watch, by any clock',
        actual: {
          status: before.status,
          watch: before.watchRoundId,
          roundRef: before.roundRef,
          visitor: await anyone(later),
        },
        expected: {
          status: 'closed',
          watch: null,
          roundRef: null,
          visitor: null,
        },
      });

      await f.sql`update broadcasts set released_through_at=${new Date(
        startedAt.getTime() + SPECTATOR_MARGIN_MS,
      )} where round_id=${roundId}`;
      const after = await outside();
      assert({
        given: 'the timeline past the start, read from outside',
        should:
          'point to the Round, still closed, still with no live reference',
        actual: {
          status: after.status,
          watch: after.watchRoundId,
          roundRef: after.roundRef,
          visitor: await anyone(later),
        },
        expected: {
          status: 'closed',
          watch: roundId,
          roundRef: null,
          visitor: roundId,
        },
      });
      const own = await f.operations.view(cast.host, room.id);
      assert({
        given: 'the same Room read by its seated host',
        should: 'keep the real Room and no pointer away from it',
        actual: [own.status, own.watchRoundId, own.roundRef?.id],
        expected: ['started', null, roundId],
      });

      for (const visibility of ['unlisted', 'private'] as const) {
        await f.sql`update rounds set visibility=${visibility}, audience_link_hash=${visibility === 'unlisted' ? 'a'.repeat(64) : null} where id=${roundId}`;
        const hidden = await outside().catch(() => null);
        assert({
          given: `a released ${visibility} Round, by its Room link alone`,
          should:
            'grant no pointer: only its own audience link reaches an audience',
          actual: [hidden?.watchRoundId ?? null, await anyone(later)],
          expected: [null, null],
        });
      }
    } finally {
      await f.sql`update rounds set visibility='public', audience_link_hash=null where id=${roundId}`;
      await f.sql`delete from broadcasts where round_id=${roundId}`;
    }
  });
});
