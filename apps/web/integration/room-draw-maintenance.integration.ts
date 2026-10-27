import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { drawRoomOverrides } from './room-draw.test-support';
import { withRoomRuntime } from './room-runtime.test-support';

requireTestServices(process.env);
setupRitewayBun();

const lines = [1, 2, 3, 4, 5].map((n) => `Maintenance proof line ${n}`);

test('maintenance selects only draws whose next strike is due (PR #472 review)', async () => {
  await withRoomRuntime(async (f) => {
    const overrides = await drawRoomOverrides(f, {
      kind: 'host',
      resolutions: lines,
    });
    // Two humans: the Negative's three-minute window is nowhere near due.
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
    await new Promise((resolve) => setTimeout(resolve, 3_500));
    const due = await candidates();
    assert({
      given:
        'a draw waiting on a human window, and one whose automatic strike falls due after three seconds',
      should:
        'select neither before anything is due, then only the draw whose strike is due',
      actual: {
        early: [early.includes(humans.id), early.includes(botRoom.id)],
        due: [due.includes(humans.id), due.includes(botRoom.id)],
      },
      expected: { early: [false, false], due: [false, true] },
    });
  });
});
