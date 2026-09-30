import { sampleRooms, sampleViewer } from '../../ui/mock/rooms';
import { filterRooms, tabCounts, type TabCounts, type Viewer } from './filter';
import type { LobbyQuery } from './query';
import type { RoomListItem } from './room';
import { sortRooms } from './sort';

export type LobbyListing = {
  readonly viewer: Viewer;
  readonly rooms: readonly RoomListItem[];
  readonly counts: TabCounts;
};

/**
 * The lobby's one data seam. It returns the rooms for a query as seen by the
 * signed-in viewer at `now` (an ISO timestamp the caller injects). Today it
 * reads the sample rooms; the backend read that lists open and live rooms
 * replaces this function and nothing else.
 */
export function listRooms(query: LobbyQuery, now: string): LobbyListing {
  const viewer = sampleViewer;
  const all = sampleRooms(now);
  return {
    viewer,
    rooms: sortRooms(filterRooms(all, query, viewer), query.sort, viewer, now),
    counts: tabCounts(all),
  };
}
