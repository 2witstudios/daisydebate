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
        'narrow by status and mode at the source and report seat counts, the format name, waiting and live facts',
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
          formatLabel: 'Foundation (architectural proof)',
          seats: [0, seatCount],
          waiting: 'since',
          stage: 'not live',
          roundId: null,
          hostRating: null,
        },
        launchedFacts: {
          formatLabel: 'Foundation (architectural proof)',
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
