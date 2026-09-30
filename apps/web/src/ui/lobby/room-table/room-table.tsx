import Link from 'next/link';
import type { Viewer } from '../../../features/lobby/filter';
import type { RoomListItem } from '../../../features/lobby/room';
import { buttonClass } from '../../components/button/button-class';
import { cn } from '../../cn';
import { RoomRow } from '../room-row/room-row';
import { roomColumnClass, roomGridClass } from '../room-row/room-row-class';

export type RoomTableProps = {
  readonly rooms: readonly RoomListItem[];
  readonly viewer: Viewer;
  readonly now: string;
  /** Where "Clear filters" goes when nothing matches. */
  readonly clearHref: string;
};

const heading = cn(
  roomGridClass,
  'px-5 py-3 text-2xs font-bold tracking-wider text-ink-faint uppercase max-compact:hidden',
);

/** The room list: a column header, one row per room, or the empty state. */
export function RoomTable({ rooms, viewer, now, clearHref }: RoomTableProps) {
  return (
    <section
      aria-label="Rooms"
      className="overflow-hidden rounded-lg border border-border bg-surface shadow-1"
    >
      <div className={heading} aria-hidden="true">
        <span className={roomColumnClass('name')}>Room</span>
        <span className={roomColumnClass('players')}>Players · rating</span>
        <span className={roomColumnClass('status')}>Status</span>
      </div>
      {rooms.length === 0 ? (
        <div className="flex flex-col items-center gap-3 border-t border-border px-5 py-8 text-base text-ink-muted">
          <p>No rooms match these filters</p>
          <Link
            href={clearHref}
            className={cn(
              buttonClass('secondary'),
              'no-underline hover:no-underline',
            )}
          >
            Clear filters
          </Link>
        </div>
      ) : (
        <ul>
          {rooms.map((room) => (
            <RoomRow key={room.id} room={room} viewer={viewer} now={now} />
          ))}
        </ul>
      )}
    </section>
  );
}
