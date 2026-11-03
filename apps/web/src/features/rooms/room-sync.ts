import type { RoomView } from '@daisy/protocol';
import {
  resourceSync,
  seedResourceSync,
  type ResourceIdentity,
  type ResourceSync,
} from '../resource-sync/resource-sync';
import type { RoomCommandIds } from './room-command-ids';

/** The room view with the command identifiers offered for it. */
export type RoomSnapshot = {
  readonly view: RoomView;
  readonly ids: RoomCommandIds;
};
export type RoomSync = ResourceSync<RoomSnapshot>;

/**
 * Rooms order by `changeVersion`. An equal version is re-read for its
 * time-derived fields (prep remaining and finished, and the capabilities
 * that follow) and keeps the identifiers already offered; a newer one brings
 * its own, so an accepted command's identifier is never offered again.
 */
export const roomIdentity: ResourceIdentity<RoomSnapshot> = {
  id: (snapshot) => snapshot.view.id,
  version: (snapshot) => snapshot.view.changeVersion,
  sameVersion: (held, next) => ({ view: next.view, ids: held.ids }),
};

export const roomSync = resourceSync(roomIdentity);

export const seedRoomSync = (
  view: RoomView,
  ids: RoomCommandIds,
  at: number,
): RoomSync => seedResourceSync(roomIdentity, { view, ids }, at);
