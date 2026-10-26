import Link from 'next/link';
import type { RoomListEntry } from '@daisy/protocol';
import {
  defaultLobbyFilters,
  isFiltered,
  lobbyHref,
  type LobbyQuery,
} from '../../features/lobby/discovery-query';
import { lobbySections } from '../../features/lobby/rows';
import { openRoomHref, playOptions } from '../../features/play/options';
import { YourRoom, type ActiveRoomSummary } from '../active-room/your-room';
import { buttonClass } from '../components/button/button-class';
import { PageHeader } from '../components/page-header/page-header';
import { PlayChoices } from '../play/play-choices/play-choices';
import { PlayDialog } from '../play/play-dialog/play-dialog';
import { LobbyFilters } from './lobby-filters/lobby-filters';
import { RoomList } from './room-list/room-list';

export type LobbyProps = {
  readonly query: LobbyQuery;
  /** One page of the canonical listing; visibility and permissions are its own. */
  readonly rooms: readonly RoomListEntry[];
  readonly nextCursor: string | null;
  /** The listing changed under the cursor: this page must be asked for again. */
  readonly retry: boolean;
  readonly activeRoom: ActiveRoomSummary | null;
};

const emptyClass =
  'flex flex-col items-center gap-3 rounded-lg border border-border bg-surface-raised px-5 py-8 text-center';

function Empty({
  query,
  rooms,
}: {
  readonly query: LobbyQuery;
  readonly rooms: number;
}) {
  const narrowed =
    query.list.q !== '' ||
    query.filters.status !== 'all' ||
    isFiltered(query.filters);
  if (rooms === 0 && !narrowed && query.list.cursor === undefined)
    return (
      <div role="status" className={emptyClass}>
        <p className="text-lg font-strong">No open rooms right now</p>
        <Link href={openRoomHref} className={buttonClass('primary')}>
          New room
        </Link>
      </div>
    );
  return (
    <div role="status" className={emptyClass}>
      <p className="text-lg font-strong">No rooms match</p>
      <Link
        href={lobbyHref({
          list: { q: '', pageSize: query.list.pageSize },
          filters: defaultLobbyFilters,
        })}
        className="font-strong"
      >
        Clear search and filters
      </Link>
    </div>
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
  nextCursor,
  retry,
  activeRoom,
}: LobbyProps) {
  const sections = lobbySections(rooms, query.filters);
  const shown = sections.reduce((count, s) => count + s.rows.length, 0);
  const { cursor } = query.list;
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-5 px-6 pt-5 pb-8 max-compact:px-4">
      <PageHeader
        title="Lobby"
        actions={
          <>
            <PlayDialog>
              <PlayChoices options={playOptions} />
            </PlayDialog>
            <Link href={openRoomHref} className={buttonClass('primary')}>
              New room
            </Link>
          </>
        }
      />
      {activeRoom ? <YourRoom room={activeRoom} /> : null}
      <LobbyFilters query={query} resultCount={shown} />
      {retry ? (
        <p
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-surface-overlay px-4 py-3"
        >
          Rooms changed while you were paging.
          <Link href={lobbyHref(query, cursor)} className="font-strong">
            Refresh
          </Link>
        </p>
      ) : shown === 0 ? (
        <Empty query={query} rooms={rooms.length} />
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
