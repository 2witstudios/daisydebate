import { buildRoomTopic, type RoomView } from '@daisy/protocol';
import type { Scheduler } from '../realtime/connection-store';
import {
  createResourceSyncDriver,
  type SyncConnection,
  type SyncVisibility,
} from '../resource-sync/driver';
import type { RoomRead } from './read-assembly';
import { roomCommandIds } from './room-command-ids';
import { attachVersionDoorbell } from '../resource-sync/doorbell';
import { roomDeadline, roomIdentity, type RoomSync } from './room-sync';

/**
 * Resource sync for an assembling room (ADR 0066): its `room:<id>`
 * doorbell, the room read, a read at the next strike or prep deadline, and fresh command
 * identifiers for every view it adopts.
 */
export function createRoomSyncDriver({
  seed,
  read,
  nextId,
  scheduler,
  visibility,
  connection,
}: {
  readonly seed: RoomSync;
  readonly read: () => Promise<RoomRead>;
  readonly nextId: () => string;
  readonly scheduler: Scheduler;
  readonly visibility: SyncVisibility;
  readonly connection: SyncConnection | null;
}) {
  const snapshot = (view: RoomView) => ({
    view,
    ids: roomCommandIds(view, nextId),
  });
  const driver = createResourceSyncDriver({
    identity: roomIdentity,
    seed,
    read: async () => {
      const answer = await read();
      return answer.kind === 'found'
        ? { kind: 'found', value: snapshot(answer.view) }
        : answer;
    },
    scheduler,
    visibility,
    connection,
    doorbell: (subscribed, signal) =>
      attachVersionDoorbell({
        topic: buildRoomTopic(seed.value.view.id),
        kind: 'room.changed',
        id: seed.value.view.id,
        connection: subscribed,
        signal,
      }),
    deadline: roomDeadline,
  });
  return {
    ...driver,
    accepted: (view: RoomView) => driver.accepted(snapshot(view)),
  };
}
