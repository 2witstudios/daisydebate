import { requireTestServices } from '@daisy/config';
import { maintainRoom } from '@daisy/debate-engine';
import { AUTOMATIC_STRIKE_DELAY_MS } from '@daisy/protocol/resolution-draw';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { drawRoomOverrides } from './room-draw.test-support';
import { withRoomRuntime } from './room-runtime.test-support';

requireTestServices(process.env);
setupRitewayBun();

const lines = [1, 2, 3, 4, 5].map((n) => `Maintenance proof line ${n}`);

/**
 * Draw rows are immutable (a strike can't be backdated), so the automatic
 * turn really falls due by the clock: poll to a bounded deadline for it.
 */
const until = async <T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
) => {
  const deadline = Date.now() + AUTOMATIC_STRIKE_DELAY_MS + 10_000;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > deadline) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
};

test('maintenance selects only draws whose next strike is due, then settles the persisted strike (PR #472 review)', async () => {
  await withRoomRuntime(async (f) => {
    const overrides = await drawRoomOverrides(f, {
      kind: 'host',
      resolutions: lines,
    });
    // Two humans: the Negative's window is nowhere near due.
    const cast = await f.freshCast();
    const humans = await f.assemble(overrides, cast);
    await f.command(cast.host, humans, { type: 'start-pre-round' });
    // A bot Negative strikes first, automatically, three seconds after the start.
    const botRoom = await f.seatBotOpponent(
      (await f.create(overrides)).view,
      (await f.bot()).actorId,
    );
    await f.command(f.host, botRoom, { type: 'start-pre-round' });
    const candidates = () =>
      f.store.readMaintenanceCandidates({ idleTimeoutMs: null, limit: 64 });
    const early = await candidates();
    const due = await until(candidates, (ids) => ids.includes(botRoom.id));
    const settled = await f.store.maintainRoom({
      roomId: botRoom.id,
      maintain: (state, facts) =>
        maintainRoom(state, { ...facts, idleTimeoutMs: null }),
    });
    const strikes = await f.sql`
      select s.ordinal, s.kind, s.actor_id, s.side
        from room_resolution_strikes s
        join room_resolution_draws d on d.id = s.draw_id
       where d.room_id = ${botRoom.id}`;
    assert({
      given:
        'a draw waiting on a human window, and one whose automatic strike falls due after three seconds',
      should:
        'select neither before anything is due, then only the due draw, and persist its automatic strike with no actor',
      actual: {
        early: [early.includes(humans.id), early.includes(botRoom.id)],
        due: [due.includes(humans.id), due.includes(botRoom.id)],
        settled,
        strikes: [...strikes],
      },
      expected: {
        early: [false, false],
        due: [false, true],
        settled: true,
        strikes: [
          { ordinal: 0, kind: 'automatic', actor_id: null, side: 'negative' },
        ],
      },
    });
  });
});
