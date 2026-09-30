import type { Viewer } from './filter';
import { bandAccepts, type RoomListItem } from './room';

/**
 * Whether the viewer may take the open seat. Only a ranked table gates on the
 * accepted rating band; a casual table takes anyone, and a live room has no
 * seat to take.
 */
export const canTakeSeat = (room: RoomListItem, viewer: Viewer): boolean =>
  room.status === 'open' &&
  (room.mode === 'casual' || bandAccepts(room.band, viewer.rating));
