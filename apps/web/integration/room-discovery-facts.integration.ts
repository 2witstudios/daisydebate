import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  launchRuntimeRound,
  withRoomRuntime,
} from './round-runtime.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('Lobby discovery filters by status and mode and reports seats, format and live facts', async () => {
  await withRoomRuntime(async (f) => {
    const title = createId();
    const open = (await f.create({ title }, (await f.freshCast()).host)).view;
    const cast = await f.freshCast();
    const launched = await f.assemble({ title }, cast);
    const { roundId } = await launchRuntimeRound(f, launched);
    const list = (filters: {
      status?: 'open' | 'starting' | 'live';
      mode?: 'ranked' | 'casual';
    }) => f.operations.list(f.outsider, { q: title, pageSize: 20, ...filters });
    const all = await list({});
    const facts = (id: string) => {
      const room = all.rooms.find((entry) => entry.id === id)!;
      return {
        formatLabel: room.formatLabel,
        seats: [room.seatsTaken, room.seatCount],
        waiting: room.waitingSince === null ? null : 'since',
        stage: room.live === null ? 'not live' : room.live.stage,
        roundId: room.roundRef === null ? null : room.roundRef.id,
        hostRating: room.hostRating,
      };
    };
    const seatCount =
      launched.definition.seats.affirmative +
      launched.definition.seats.negative +
      launched.definition.seats.judge;
    assert({
      given:
        'an open casual Room and a launched one sharing a title, listed with and without filters',
      should:
        'narrow by status and mode at the source and report seat counts, the format name (a proof room is a custom format), waiting and live facts',
      actual: {
        live: (await list({ status: 'live' })).rooms.map((room) => room.id),
        open: (await list({ status: 'open' })).rooms.map((room) => room.id),
        starting: (await list({ status: 'starting' })).rooms.length,
        ranked: (await list({ mode: 'ranked' })).rooms.length,
        openFacts: facts(open.id),
        launchedFacts: facts(launched.id),
      },
      expected: {
        live: [launched.id],
        open: [open.id],
        starting: 0,
        ranked: 0,
        openFacts: {
          formatLabel: 'Custom format',
          seats: [0, seatCount],
          waiting: 'since',
          stage: 'not live',
          roundId: null,
          hostRating: null,
        },
        launchedFacts: {
          formatLabel: 'Custom format',
          seats: [2, seatCount],
          waiting: null,
          stage: null,
          roundId,
          hostRating: null,
        },
      },
    });
  });
});

test('Lobby filters run before paging: a one-row page walks only the filtered set', async () => {
  await withRoomRuntime(async (f) => {
    const title = createId();
    const opened = [];
    const live = [];
    for (let i = 0; i < 2; i++) {
      opened.push(
        (await f.create({ title }, (await f.freshCast()).host)).view.id,
      );
      const room = await f.assemble({ title }, await f.freshCast());
      await launchRuntimeRound(f, room);
      live.push(room.id);
    }
    // Two open and two launched Rooms: whichever kind sorts first, one walk
    // below starts behind a candidate its filter rejects.
    const walk = async (status: 'open' | 'live') => {
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 4; page++) {
        const result = await f.operations.list(f.outsider, {
          q: title,
          pageSize: 1,
          status,
          ...(cursor ? { cursor } : {}),
        });
        seen.push(...result.rooms.map((room) => room.id));
        if (!result.nextCursor) break;
        cursor = result.nextCursor;
      }
      return seen;
    };
    const newest = async (ids: string[]) =>
      (
        await f.sql`select id from rooms where id=any(${f.sql.array(ids, 'text')}::text[])
        order by created_at desc,id collate "C" desc`
      ).map((row: { id: string }) => row.id);
    assert({
      given: 'one-row pages under the open and the live filter',
      should:
        'return every matching Room in cursor order and none of the others',
      actual: [await walk('open'), await walk('live')],
      expected: [await newest(opened), await newest(live)],
    });
  });
});
