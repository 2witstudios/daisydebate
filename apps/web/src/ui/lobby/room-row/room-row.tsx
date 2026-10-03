import Link from 'next/link';
import { roomAction } from '../../../features/lobby/actions';
import type { Viewer } from '../../../features/lobby/filter';
import {
  bandLabel,
  judgeLabel,
  modeLabel,
  rulesLabel,
  statusLabel,
} from '../../../features/lobby/labels';
import type { RoomListItem } from '../../../features/lobby/room';
import { buttonClass } from '../../components/button/button-class';
import { StatusLine } from '../../components/status-line/status-line';
import { cn } from '../../cn';
import {
  modeClass,
  roomColumnClass,
  roomGridClass,
  seatClass,
} from './room-row-class';

export type RoomRowProps = {
  readonly room: RoomListItem;
  readonly viewer: Viewer;
  /** ISO timestamp the waiting time counts from. */
  readonly now: string;
};

const rating = 'text-sm text-ink-faint tabular-nums';
const actionClass = 'w-full whitespace-nowrap no-underline hover:no-underline';

function Player({ handle, value }: { handle: string; value: string }) {
  return (
    <span className="flex items-baseline gap-2">
      <span className={seatClass(true)}>{`@${handle}`}</span>
      <span className={rating}>{value}</span>
    </span>
  );
}

function RoomAction({ room, viewer }: Pick<RoomRowProps, 'room' | 'viewer'>) {
  const action = roomAction(room, viewer);
  const take = action.kind === 'take-seat';
  const className = cn(
    buttonClass(take ? 'primary' : 'secondary'),
    actionClass,
  );
  const label = take ? 'Take seat' : 'Spectate';
  if (action.enabled) {
    return (
      <Link
        href={action.href}
        className={className}
        aria-label={`${label}, ${room.name}`}
      >
        {label}
      </Link>
    );
  }
  const band = room.status === 'open' ? bandLabel(room.band) : '';
  return (
    <button
      type="button"
      disabled
      className={className}
      aria-label={`${label}, ${room.name} (your rating is outside ${band})`}
    >
      {label}
    </button>
  );
}

/** One room: name and rules, both seats, status and its single action. */
export function RoomRow({ room, viewer, now }: RoomRowProps) {
  return (
    <li
      className={cn(
        roomGridClass,
        'min-h-16 border-t border-border px-5 py-3 max-compact:px-4',
      )}
    >
      <div className={cn(roomColumnClass('name'), 'flex flex-col gap-1')}>
        <p className="truncate text-md font-strong text-ink">{room.name}</p>
        <p className="text-sm text-ink-muted">
          <span className={modeClass(room.mode)}>{modeLabel(room)}</span>
          {' · '}
          {rulesLabel(room)}
          {' · '}
          {judgeLabel(room)}
        </p>
      </div>
      <div
        className={cn(
          roomColumnClass('players'),
          'flex flex-col gap-1 text-base max-compact:flex-row max-compact:flex-wrap max-compact:gap-x-2 max-compact:gap-y-0',
        )}
      >
        <Player handle={room.host.handle} value={String(room.host.rating)} />
        <span className="flex items-baseline gap-2 whitespace-nowrap">
          <span className="text-xs text-ink-faint">vs</span>
          {room.status === 'live' ? (
            <Player
              handle={room.opponent.handle}
              value={String(room.opponent.rating)}
            />
          ) : (
            <>
              <span className={seatClass(false)}>Open seat</span>
              <span className={rating}>{bandLabel(room.band)}</span>
            </>
          )}
        </span>
      </div>
      <p className={cn(roomColumnClass('status'), 'text-sm text-ink-muted')}>
        {room.status === 'live' ? (
          <StatusLine tone="live">{statusLabel(room, now)}</StatusLine>
        ) : (
          statusLabel(room, now)
        )}
      </p>
      <div className={roomColumnClass('action')}>
        <RoomAction room={room} viewer={viewer} />
      </div>
    </li>
  );
}
