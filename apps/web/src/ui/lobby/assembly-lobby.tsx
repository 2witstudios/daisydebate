import Link from 'next/link';
import type { ActiveRoom, RoomListEntry, RoomListQuery } from '@daisy/protocol';
import { ActiveRoomNotice } from '../rooms/active-room/active-room-notice';
import { buttonClass } from '../components/button/button-class';
import { controlClass } from '../components/form-field/form-field-class';
import { MediaPageLink } from '../round-media/media-page-link';

/** The canonical listing supplies visibility and permissions; no sample fallback. */
export function AssemblyLobby({
  rooms,
  query,
  nextCursor,
  retry,
  activeRoom,
}: {
  readonly rooms: readonly RoomListEntry[];
  readonly query: RoomListQuery;
  readonly nextCursor: string | null;
  readonly retry: boolean;
  /** The viewer's own active Room (ADR 0070), pinned above the listing. */
  readonly activeRoom: ActiveRoom | null;
}) {
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-6 px-6 py-8">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Lobby</h1>
          <p className="text-ink-muted">Find a room or create your own.</p>
        </div>
        <Link href="/play/room" className={buttonClass('primary')}>
          Create room
        </Link>
      </header>
      {activeRoom ? <ActiveRoomNotice activeRoom={activeRoom} /> : null}
      <form action="/lobby" method="get" className="flex gap-3">
        <label htmlFor="room-search" className="sr-only">
          Search rooms
        </label>
        <input
          id="room-search"
          type="search"
          maxLength={100}
          name="q"
          defaultValue={query.q}
          className={controlClass}
          placeholder="Search rooms, topics or hosts"
        />
        <input type="hidden" name="pageSize" value={query.pageSize} />
        <button type="submit" className={buttonClass('secondary')}>
          Search
        </button>
      </form>
      {rooms.length === 0 ? (
        <p role="status">
          {retry
            ? 'Rooms changed. Retry this page.'
            : query.q
              ? 'No rooms match your search.'
              : 'No rooms are available. Create the first one.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Available rooms">
          {rooms.map((room) => (
            <li key={room.id} className="rounded-xl bg-surface p-5 shadow-1">
              <div className="flex justify-between gap-4">
                <MediaPageLink
                  href={`/rooms/${room.id}`}
                  className="font-strong text-ink"
                >
                  {room.title}
                </MediaPageLink>
                <span className="text-sm text-ink-muted">{room.status}</span>
              </div>
              <p>{room.topic}</p>
              <p className="text-sm text-ink-muted">
                {room.hostLabel !== null ? `Host: ${room.hostLabel} · ` : null}
                {room.competitionType}
              </p>
              {room.roundRef ? (
                <MediaPageLink href={`/rounds/${room.roundRef.id}`}>
                  View Round
                </MediaPageLink>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <nav aria-label="Room pages" className="flex gap-3">
        {retry ? (
          <Link
            href={`/lobby?${new URLSearchParams({ q: query.q, pageSize: String(query.pageSize), ...(query.cursor ? { cursor: query.cursor } : {}) })}`}
          >
            Retry page
          </Link>
        ) : null}
        {query.cursor ? (
          <Link
            href={`/lobby?${new URLSearchParams({ q: query.q, pageSize: String(query.pageSize) })}`}
          >
            First page
          </Link>
        ) : null}
        {nextCursor ? (
          <Link
            href={`/lobby?${new URLSearchParams({ q: query.q, pageSize: String(query.pageSize), cursor: nextCursor })}`}
          >
            Next page
          </Link>
        ) : null}
      </nav>
    </div>
  );
}
