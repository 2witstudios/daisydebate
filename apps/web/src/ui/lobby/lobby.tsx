import { Announcement } from '../components/announcement/announcement';
import Link from 'next/link';
import {
  type RoomListEntry,
  type RoomListQuery,
} from '@daisy/protocol/room-contract';
import { isFiltered, lobbyHref } from '../../features/lobby/discovery-query';
import type { StandingLobbyChoice } from '@daisy/protocol/lobby/eligibility';
import { lobbySections, type LobbyViewer } from '../../features/lobby/rows';
import { openRoomHref, type PlayOption } from '../../features/play/options';
import { YourRoom, type ActiveRoomSummary } from '../active-room/your-room';
import { buttonClass } from '../components/button/button-class';
import { PageHeader } from '../components/page-header/page-header';
import { Segmented } from '../components/segmented/segmented';
import { defaultLiveQuery, hubHref } from '../../features/watch/live-query';
import { PlayChoices } from '../play/play-choices/play-choices';
import { PlayDialog } from '../play/play-dialog/play-dialog';
import { LobbyFilters } from './lobby-filters/lobby-filters';
import { RoomList } from './room-list/room-list';

export type LobbyProps = {
  /**
   * The canonical listing query: the URL's one source of filter state, its
   * lobby resolved (the viewer's own when the URL names none).
   */
  readonly query: RoomListQuery;
  readonly lobbies: readonly StandingLobbyChoice[];
  readonly view?: 'rooms';
  /** One page of the canonical listing, already narrowed by the query. */
  readonly rooms: readonly RoomListEntry[];
  readonly nextCursor: string | null;
  /** The listing changed under the cursor: this page must be asked for again. */
  readonly retry: boolean;
  readonly activeRoom: ActiveRoomSummary | null;
  /** When the page is read (epoch ms), for how long open Rooms have waited. */
  readonly now: number;
  /** Who reads the Lobby: which seats are theirs and which live Rounds they may watch. */
  readonly viewer: LobbyViewer;
  /** The Play dialog's choices for this viewer (`playOptionsFor`). */
  readonly playOptions: readonly PlayOption[];
};

const emptyClass =
  'flex flex-col items-center gap-3 rounded-lg border border-border bg-surface-raised px-5 py-8 text-center';

const createHref = (lobbyId: string | undefined) =>
  lobbyId === undefined
    ? openRoomHref
    : `${openRoomHref}?${new URLSearchParams({ lobby: lobbyId })}`;

function Empty({ query }: { readonly query: RoomListQuery }) {
  const narrowed =
    query.q !== '' || query.status !== undefined || isFiltered(query);
  if (!narrowed && query.cursor !== undefined)
    return (
      <Announcement as="div" kind="progress" className={emptyClass}>
        <p className="text-lg font-strong">No more rooms</p>
      </Announcement>
    );
  if (!narrowed)
    return (
      <Announcement as="div" kind="progress" className={emptyClass}>
        <p className="text-lg font-strong">No open rooms right now</p>
        <Link
          href={createHref(query.lobbyId)}
          className={buttonClass('primary')}
        >
          New room
        </Link>
      </Announcement>
    );
  return (
    <Announcement as="div" kind="progress" className={emptyClass}>
      <p className="text-lg font-strong">No rooms match</p>
      <Link
        href={lobbyHref({
          q: '',
          pageSize: query.pageSize,
          lobbyId: query.lobbyId,
        })}
        className="font-strong"
      >
        Clear search and filters
      </Link>
    </Announcement>
  );
}

/**
 * The Lobby, where people find, join, host and return to debates: the
 * viewer's own Room pinned first, then every listed Room as one compact row
 * grouped open, starting and live. Play opens the other ways to play over it.
 */
export function Lobby({
  query,
  rooms,
  lobbies,
  view,
  nextCursor,
  retry,
  activeRoom,
  now,
  viewer,
  playOptions,
}: LobbyProps) {
  const sections = lobbySections(now, rooms, viewer);
  const { cursor } = query;
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-5 px-6 pt-5 pb-8 max-compact:px-4">
      <PageHeader
        title="Lobby"
        actions={
          <>
            <Link
              href={hubHref({
                ...defaultLiveQuery,
                lobby: query.lobbyId ?? '',
              })}
              className={buttonClass('ghost')}
            >
              Watch live
            </Link>
            <PlayDialog>
              <PlayChoices options={playOptions} />
            </PlayDialog>
            <Link
              href={createHref(query.lobbyId)}
              className={buttonClass('primary')}
            >
              New room
            </Link>
          </>
        }
      />
      {lobbies.length > 0 ? (
        <Segmented
          label="Lobby"
          wrap
          fillOnPhone
          segments={lobbies.map(({ id, name }) => ({
            label: name,
            href: lobbyHref({ ...query, lobbyId: id }, undefined, view),
            selected: query.lobbyId === id,
          }))}
        />
      ) : null}
      {activeRoom ? <YourRoom room={activeRoom} /> : null}
      <LobbyFilters query={query} resultCount={rooms.length} />
      {retry ? (
        <Announcement
          as="p"
          kind="progress"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-surface-overlay px-4 py-3"
        >
          Rooms changed while you were paging.
          <Link href={lobbyHref(query, cursor)} className="font-strong">
            Refresh
          </Link>
        </Announcement>
      ) : rooms.length === 0 ? (
        <Empty query={query} />
      ) : (
        <RoomList sections={sections} />
      )}
      {cursor !== undefined || nextCursor !== null ? (
        <nav aria-label="Room pages" className="flex justify-center gap-6">
          {cursor === undefined ? null : (
            <Link href={lobbyHref(query)} className="font-strong">
              First page
            </Link>
          )}
          {nextCursor === null ? null : (
            <Link href={lobbyHref(query, nextCursor)} className="font-strong">
              Next page
            </Link>
          )}
        </nav>
      ) : null}
    </div>
  );
}
