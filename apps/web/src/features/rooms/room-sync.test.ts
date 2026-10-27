import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RoomView } from '@daisy/protocol';
import { assemblySnapshot } from './assembly.test-support';
import type { RoomCommandIds } from './room-command-ids';
import {
  prepDeadline,
  presentedView,
  roomSync,
  seedRoomSync,
} from './room-sync';

setupRitewayBun();

const ids = (tag: string): RoomCommandIds => ({
  header: { details: `${tag}d`, leave: `${tag}l`, close: `${tag}c` },
  readiness: { ready: `${tag}r`, unready: `${tag}u`, 'start-round': `${tag}s` },
  prep: { start: `${tag}ps`, finish: `${tag}pf` },
  strikes: [],
  settings: `${tag}x`,
  seats: [],
  format: { choose: `${tag}fc`, reset: `${tag}fr`, template: `${tag}ft` },
});
const view = (
  changeVersion: number,
  patch: Partial<RoomView> = {},
): RoomView => ({
  ...assemblySnapshot,
  version: changeVersion,
  changeVersion,
  ...patch,
});
const seeded = seedRoomSync(view(3), ids('a'), 1000);
const read = (
  changeVersion: number,
  tag: string,
  patch: Partial<RoomView> = {},
) =>
  roomSync(roomSync(seeded, { type: 'read' }), {
    type: 'found',
    value: { view: view(changeVersion, patch), ids: ids(tag) },
    at: 9000,
  });
const running = (remainingMs: number, finished = false) => ({
  prep: { startedAt: '2026-01-01T00:00:00.000Z', remainingMs, finished },
});

describe('room sync', () => {
  test('command identifiers rotate only when the room changes', () => {
    assert({
      given: 'a read of a newer change, and a read of the change already held',
      should:
        'offer the new identifiers for the newer change and keep them for the same one',
      actual: [
        read(4, 'b').value.ids.settings,
        read(3, 'b', running(0, true)).value.ids.settings,
        read(3, 'b', running(0, true)).value.view.prep.finished,
      ],
      expected: ['bx', 'ax', true],
    });
  });
});

describe('room sync time', () => {
  const prepping = seedRoomSync(view(3, running(60000)), ids('a'), 1000);

  test('prep remaining counts down from the read that reported it', () => {
    assert({
      given: 'prep with 60 s left at the read, observed 15 s and 90 s later',
      should: 'present 45 s, then zero, never negative',
      actual: [
        presentedView(prepping, 16000).prep.remainingMs,
        presentedView(prepping, 91000).prep.remainingMs,
      ],
      expected: [45000, 0],
    });
  });

  test('a running prep has a read deadline; any other room has none', () => {
    assert({
      given:
        'a running prep, rooms without prep and with finished prep, and a prep with no time left not yet marked finished',
      should:
        'schedule a read when the reported time runs out, otherwise none, so no read loops at zero',
      actual: [
        prepDeadline(prepping),
        prepDeadline(seeded),
        prepDeadline(seedRoomSync(view(3, running(0, true)), ids('a'), 1000)),
        prepDeadline(seedRoomSync(view(3, running(0)), ids('a'), 1000)),
      ],
      expected: [61000, null, null, null],
    });
  });

  test('a room without running prep is presented as read', () => {
    assert({
      given: 'a room with no prep running',
      should: 'present the held view itself',
      actual: presentedView(seeded, 50000) === seeded.value.view,
      expected: true,
    });
  });
});
