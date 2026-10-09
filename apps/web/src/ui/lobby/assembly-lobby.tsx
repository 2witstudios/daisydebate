import Link from 'next/link';
import type { RoomView } from '@daisy/protocol';
import { buttonClass } from '../components/button/button-class';
import { controlClass } from '../components/form-field/form-field-class';

/** The canonical listing supplies visibility and permissions; no sample fallback. */
export function AssemblyLobby({
  rooms,
  query,
}: {
  readonly rooms: readonly RoomView[];
  readonly query: string;
}) {
  const needle = query.toLocaleLowerCase();
  const visible = rooms.filter((room) =>
    [room.title, room.topic, room.hostLabel].some((text) =>
      text.toLocaleLowerCase().includes(needle),
    ),
  );
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
      <form action="/lobby" method="get" className="flex gap-3">
        <label htmlFor="room-search" className="sr-only">
          Search rooms
        </label>
        <input
          id="room-search"
          type="search"
          name="q"
          defaultValue={query}
          className={controlClass}
          placeholder="Search rooms, topics or hosts"
        />
        <button type="submit" className={buttonClass('secondary')}>
          Search
        </button>
      </form>
      {visible.length === 0 ? (
        <p role="status">
          {query
            ? 'No rooms match your search.'
            : 'No rooms are available. Create the first one.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Available rooms">
          {visible.map((room) => (
            <li key={room.id} className="rounded-xl bg-surface p-5 shadow-1">
              <div className="flex justify-between gap-4">
                <Link
                  href={`/rooms/${room.id}`}
                  className="font-strong text-ink"
                >
                  {room.title}
                </Link>
                <span className="text-sm text-ink-muted">{room.status}</span>
              </div>
              <p>{room.topic}</p>
              <p className="text-sm text-ink-muted">
                Host: {room.hostLabel} · {room.definition.seats.affirmative} aff
                / {room.definition.seats.negative} neg · {room.competitionType}
              </p>
              {room.roundRef ? (
                <Link href={`/rounds/${room.roundRef.id}`}>View Round</Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
