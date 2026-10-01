import type { LobbyQuery } from './query';
import { roomRating, type RoomListItem } from './room';

export type Viewer = {
  readonly rating: number;
};

/** Search ignores case and a leading "@" on a handle. */
const needle = (q: string): string => q.toLowerCase().replace(/^@/, '');

const matchesSearch = (room: RoomListItem, q: string): boolean => {
  if (q === '') return true;
  const text = needle(q);
  const fields = [
    room.name,
    room.host.handle,
    room.status === 'live' ? room.opponent.handle : '',
  ];
  return fields.some((field) => field.toLowerCase().includes(text));
};

/** The rooms that satisfy every filter in the query, in their given order. */
export function filterRooms(
  rooms: readonly RoomListItem[],
  query: LobbyQuery,
  viewer: Viewer,
): readonly RoomListItem[] {
  return rooms.filter(
    (room) =>
      (query.tab === 'all' || room.status === query.tab) &&
      (query.mode === 'any' || room.mode === query.mode) &&
      (query.range === 0 ||
        Math.abs(roomRating(room) - viewer.rating) <= query.range) &&
      matchesSearch(room, query.q),
  );
}

export type TabCounts = {
  readonly all: number;
  readonly open: number;
  readonly live: number;
};

/** Tab totals over the whole listing, so they do not move with filters. */
export const tabCounts = (rooms: readonly RoomListItem[]): TabCounts => ({
  all: rooms.length,
  open: rooms.filter((room) => room.status === 'open').length,
  live: rooms.filter((room) => room.status === 'live').length,
});
