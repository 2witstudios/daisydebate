import type { Viewer } from './filter';
import type { LobbySort } from './query';
import { roomRating, type RoomListItem } from './room';

/** Milliseconds an open table has waited; live rooms have no wait. */
const waitedMs = (room: RoomListItem, now: string): number | null =>
  room.status === 'open'
    ? Date.parse(now) - Date.parse(room.waitingSince)
    : null;

const watching = (room: RoomListItem): number =>
  room.status === 'live' ? room.watching : 0;

type Key = (room: RoomListItem) => number;

/** Smallest key first. A live room's missing wait sorts after every table. */
const keys = (sort: LobbySort, viewer: Viewer, now: string): Key => {
  switch (sort) {
    case 'closest':
      return (room) => Math.abs(roomRating(room) - viewer.rating);
    case 'high':
      return (room) => -roomRating(room);
    case 'low':
      return (room) => roomRating(room);
    case 'waiting':
      return (room) => -(waitedMs(room, now) ?? -Infinity);
    case 'newest':
      return (room) => waitedMs(room, now) ?? Infinity;
    case 'watched':
      return (room) => -watching(room);
  }
};

/** A new list ordered by the sort; equal keys fall back to the room id. */
export function sortRooms(
  rooms: readonly RoomListItem[],
  sort: LobbySort,
  viewer: Viewer,
  now: string,
): readonly RoomListItem[] {
  const key = keys(sort, viewer, now);
  return [...rooms].sort((a, b) => {
    const delta = key(a) - key(b);
    // Infinity - Infinity is NaN: equal keys, not an order.
    if (delta !== 0 && !Number.isNaN(delta)) return delta;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
