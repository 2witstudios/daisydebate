import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createOnlineRing } from './online-ring';

setupRitewayBun();

const timers = {
  setInterval: () => 0 as unknown as ReturnType<typeof setInterval>,
  clearInterval: () => {},
};

const setup = (revisions: readonly (number | Error)[]) => {
  const queue = [...revisions];
  let rings = 0;
  const onlineRing = createOnlineRing({
    readRevision: async () => {
      const next = queue.shift() ?? 0;
      if (next instanceof Error) throw next;
      return next;
    },
    ring: () => {
      rings += 1;
    },
    timers,
  });
  return { onlineRing, rings: () => rings };
};

describe('createOnlineRing', () => {
  test('rings only when the revision moves', async () => {
    const { onlineRing, rings } = setup([3, 3, 4, 4]);
    await onlineRing.tick();
    const afterFirstRead = rings();
    await onlineRing.tick();
    const unchanged = rings();
    await onlineRing.tick();
    await onlineRing.tick();
    assert({
      given: 'a first read, an unchanged read, then one change',
      should: 'stay quiet until the change, and ring for it once',
      actual: { afterFirstRead, unchanged, total: rings() },
      expected: { afterFirstRead: 0, unchanged: 0, total: 1 },
    });
  });

  test('rings for rows that can move a status', async () => {
    const { onlineRing, rings } = setup([1, 1, 1]);
    await onlineRing.tick();
    onlineRing.observe([{ kind: 'messaging.inbox.changed' }]);
    await onlineRing.tick();
    const ignored = rings();
    onlineRing.observe([{ kind: 'room.changed' }, { kind: 'round.phase-changed' }]);
    await onlineRing.tick();
    assert({
      given: 'an unrelated row, then two status rows in one tick',
      should: 'ignore the first and ring once for the rest',
      actual: { ignored, total: rings() },
      expected: { ignored: 0, total: 1 },
    });
  });

  test('a Redis failure still rings for rows, and never throws', async () => {
    const { onlineRing, rings } = setup([new Error('down')]);
    onlineRing.observe([{ kind: 'actor.presence-preference-changed' }]);
    await onlineRing.tick();
    assert({
      given: 'Redis failing with a status row waiting',
      should: 'ring anyway',
      actual: rings(),
      expected: 1,
    });
  });
});
