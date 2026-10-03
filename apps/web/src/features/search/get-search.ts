import type { SearchParams } from '../access/decision';
import { readLadder } from '../leaderboard/read-leaderboard';
import { listDebates } from '../watch/debate-source';
import { sampleRooms } from '../../ui/mock/rooms';
import { sampleTournaments } from '../../ui/mock/tournaments';
import {
  groupHits,
  parseSearchQuery,
  searchItems,
  type SearchGroup,
  type SearchItem,
} from './search';

export type SearchResults = {
  readonly query: string;
  readonly groups: readonly SearchGroup[];
  readonly total: number;
};

const catalog = (now: string): readonly SearchItem[] => [
  ...readLadder(null, now, null).data.entries.flatMap((entry) =>
    entry.username === null
      ? []
      : [
          {
            kind: 'person' as const,
            label: entry.username,
            detail: `Rated ${entry.rating}`,
            href: `/profile/${entry.username}`,
          },
        ],
  ),
  ...listDebates().map((debate) => ({
    kind: 'debate' as const,
    label: debate.title,
    detail: debate.mode === 'ranked' ? 'Ranked debate' : 'Casual debate',
    href: `/watch/${debate.id}`,
  })),
  ...sampleTournaments.map((tournament) => ({
    kind: 'tournament' as const,
    label: tournament.name,
    detail: `Run by ${tournament.organizer}`,
    href: `/tournaments/${tournament.id}`,
  })),
  // Only open tables have a room page; a live room is a debate to watch.
  ...sampleRooms(now)
    .filter((room) => room.status === 'open')
    .map((room) => ({
      kind: 'room' as const,
      label: room.name,
      detail: `Hosted by ${room.host.handle}`,
      href: `/rooms/${room.id}`,
    })),
];

/**
 * The search page's one data seam: what the query finds among people,
 * debates, tournaments and rooms. Today it reads the sample catalogue; the
 * backend search replaces this function and nothing else.
 */
export function getSearch(params: SearchParams, now: string): SearchResults {
  const query = parseSearchQuery(params);
  const hits = searchItems(query, catalog(now));
  return { query, groups: groupHits(hits), total: hits.length };
}
