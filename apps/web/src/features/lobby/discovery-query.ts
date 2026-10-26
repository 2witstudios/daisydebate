import {
  competitionTypes,
  roomListQuerySchema,
  roomListStatuses,
  type RoomListQuery,
  type RoomListStatus,
} from '@daisy/protocol';
import type { SearchParams } from '../access/decision';

/** The listing's own page size when the URL names none. */
export const defaultPageSize = 20;

/** A status tab: every status, or one the listing narrows to. */
export type LobbyStatus = 'all' | RoomListStatus;

/** The status tabs: every status, then each one the listing narrows to. */
export const lobbyStatusChoices: readonly LobbyStatus[] = [
  'all',
  ...roomListStatuses,
];
/** The mode select: any mode, then each competition type. */
export const lobbyModeChoices = ['any', ...competitionTypes] as const;

export type LobbyMode = (typeof lobbyModeChoices)[number];

/** The Lobby's "every status" and "any mode" choices narrow nothing. */
const narrowing = (value: SearchParams[string], everything: string) =>
  value === everything ? undefined : value;

/**
 * The Lobby's URL as the canonical listing query. One policy for every key:
 * an absent value, `all` or `any` narrows nothing; an unknown or repeated
 * value is refused, never repaired or guessed.
 */
export function parseRoomDiscoveryQuery(raw: SearchParams) {
  return roomListQuerySchema.safeParse({
    q: raw.q,
    cursor: raw.cursor,
    sort: raw.sort,
    status: narrowing(raw.status, 'all'),
    mode: narrowing(raw.mode, 'any'),
    ...(raw.pageSize === undefined
      ? {}
      : {
          pageSize:
            typeof raw.pageSize === 'string' &&
            /^(?:[1-9]|[1-4][0-9]|50)$/.test(raw.pageSize)
              ? Number(raw.pageSize)
              : NaN,
        }),
  });
}

/**
 * The Lobby URL for a query, carrying only non-default values. A cursor is
 * kept only when given: changing a tab or filter starts from the first page.
 */
export function lobbyHref(query: RoomListQuery, cursor?: string): string {
  const params = new URLSearchParams();
  if (query.q !== '') params.set('q', query.q);
  if (query.pageSize !== defaultPageSize)
    params.set('pageSize', String(query.pageSize));
  if (query.status) params.set('status', query.status);
  if (query.mode) params.set('mode', query.mode);
  if (query.sort) params.set('sort', query.sort);
  if (cursor !== undefined) params.set('cursor', cursor);
  const search = params.toString();
  return search === '' ? '/lobby' : `/lobby?${search}`;
}

/** True when a filter in the Filters panel (not the status tab) is set. */
export const isFiltered = (query: RoomListQuery): boolean =>
  query.mode !== undefined;
