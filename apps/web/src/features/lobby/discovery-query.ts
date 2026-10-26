import { z } from 'zod';
import { roomListQuerySchema, type RoomListQuery } from '@daisy/protocol';
import type { SearchParams } from '../access/decision';

const defaultPageSize = 20;

export function parseRoomDiscoveryQuery(raw: SearchParams) {
  return roomListQuerySchema.safeParse({
    q: raw.q,
    cursor: raw.cursor,
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

/** Where a Room stands as the Lobby groups it. */
export const lobbyStatuses = ['all', 'open', 'starting', 'live'] as const;
export const lobbyModes = ['any', 'ranked', 'casual'] as const;
export const lobbyLengths = ['any', 'quick', 'full'] as const;

export type LobbyStatus = (typeof lobbyStatuses)[number];
export type LobbyMode = (typeof lobbyModes)[number];
export type LobbyLength = (typeof lobbyLengths)[number];

export type LobbyFilters = {
  readonly status: LobbyStatus;
  readonly mode: LobbyMode;
  readonly length: LobbyLength;
};

export type LobbyQuery = {
  readonly list: RoomListQuery;
  readonly filters: LobbyFilters;
};

export const defaultLobbyFilters: LobbyFilters = {
  status: 'all',
  mode: 'any',
  length: 'any',
};

// A bad or repeated filter value falls back to its default: filters only
// narrow the page, so untrusted values never make the Lobby refuse.
const filtersSchema = z.object({
  status: z.enum(lobbyStatuses).catch(defaultLobbyFilters.status),
  mode: z.enum(lobbyModes).catch(defaultLobbyFilters.mode),
  length: z.enum(lobbyLengths).catch(defaultLobbyFilters.length),
});

/** The Lobby's URL state: the strict listing query plus lenient filters. */
export function parseLobbyQuery(
  raw: SearchParams,
): { success: true; data: LobbyQuery } | { success: false } {
  const list = parseRoomDiscoveryQuery(raw);
  if (!list.success) return { success: false };
  const filters = filtersSchema.parse({
    status: raw.status,
    mode: raw.mode,
    length: raw.length,
  });
  return { success: true, data: { list: list.data, filters } };
}

/**
 * The Lobby URL for a query, carrying only non-default values. A cursor is
 * kept only when given: changing a tab or filter starts from the first page.
 */
export function lobbyHref(query: LobbyQuery, cursor?: string): string {
  const params = new URLSearchParams();
  if (query.list.q !== '') params.set('q', query.list.q);
  if (query.list.pageSize !== defaultPageSize)
    params.set('pageSize', String(query.list.pageSize));
  for (const key of ['status', 'mode', 'length'] as const) {
    if (query.filters[key] !== defaultLobbyFilters[key])
      params.set(key, query.filters[key]);
  }
  if (cursor !== undefined) params.set('cursor', cursor);
  const search = params.toString();
  return search === '' ? '/lobby' : `/lobby?${search}`;
}

/** True when a filter in the Filters panel (not the status tab) is set. */
export const isFiltered = (filters: LobbyFilters): boolean =>
  filters.mode !== defaultLobbyFilters.mode ||
  filters.length !== defaultLobbyFilters.length;
