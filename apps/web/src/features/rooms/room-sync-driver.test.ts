import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  buildRoomTopic,
  ENVELOPE_VERSION,
  type RoomView,
} from '@daisy/protocol';
import { sequentialId } from '@daisy/clock';
import { driverEdges } from '../resource-sync/driver.test-support';
import { assemblySnapshot } from './assembly.test-support';
import type { RoomRead } from './read-assembly';
import { roomCommandIds } from './room-command-ids';
import { seedRoomSync } from './room-sync';
import { createRoomSyncDriver } from './room-sync-driver';

setupRitewayBun();

const roomId = assemblySnapshot.id;
const view = (
  changeVersion: number,
  patch: Partial<RoomView> = {},
): RoomView => ({
  ...assemblySnapshot,
  version: changeVersion,
  changeVersion,
  ...patch,
});

function harness(seed = view(3)) {
  const edges = driverEdges<RoomRead>();
  const ids = sequentialId('n');
  const driver = createRoomSyncDriver({
    seed: seedRoomSync(
      seed,
      roomCommandIds(seed, () => 'seed'),
      edges.scheduler.now(),
    ),
    read: edges.read,
    nextId: () => ids.next(),
    scheduler: edges.scheduler,
    visibility: edges.visibility,
    connection: edges.connection,
  });
  const bell = (changeVersion: number) =>
    edges.emit({
      v: ENVELOPE_VERSION,
      type: 'event',
      topic: buildRoomTopic(roomId),
      position: '1:1',
      payload: {
        kind: 'room.changed',
        entityVersion: changeVersion,
        ids: [roomId],
      },
    });
  return { ...edges, driver, bell, held: () => driver.readSnapshot().value };
}

describe('room sync driver', () => {
  test('the room doorbell reads the room and offers new identifiers', async () => {
    const room = harness();
    room.bell(4);
    room.answer({ kind: 'found', view: view(4, { title: 'Renamed' }) });
    await room.flush();
    assert({
      given: 'the room:<id> doorbell announcing change 4',
      should:
        'subscribe to the room topic, read once and adopt change 4 with fresh identifiers',
      actual: {
        log: room.log,
        title: room.held().view.title,
        settings: room.held().ids.settings,
      },
      expected: {
        log: [`subscribe ${buildRoomTopic(roomId)}`, 'connect', 'read'],
        title: 'Renamed',
        settings: 'n-8',
      },
    });
  });

  test('an accepted command view is adopted with new identifiers', () => {
    const room = harness();
    room.driver.accepted(view(5, { title: 'Accepted' }));
    assert({
      given: 'a hydrated command answering with change 5',
      should: 'adopt it without a read and offer new identifiers',
      actual: [room.held().view.title, room.held().ids.settings, room.reads()],
      expected: ['Accepted', 'n-8', 0],
    });
  });

  test('a running prep is read again when its time runs out', async () => {
    const prep = (remainingMs: number, finished: boolean) => ({
      prep: { startedAt: '2026-01-01T00:00:00.000Z', remainingMs, finished },
    });
    const room = harness(view(3, prep(12000, false)));
    room.advance(11999);
    const early = room.reads();
    room.advance(1);
    room.answer({ kind: 'found', view: view(3, prep(0, true)) });
    await room.flush();
    assert({
      given: 'a prep with 12 s left at the read',
      should: 'read exactly when it runs out and adopt the finished prep',
      actual: [early, room.reads(), room.held().view.prep.finished],
      expected: [0, 1, true],
    });
  });
});
