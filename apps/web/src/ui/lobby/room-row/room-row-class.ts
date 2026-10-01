import type { RoomMode } from '../../../features/lobby/room';

export type RoomColumn = 'name' | 'players' | 'status' | 'action';

/** One grid for the header and every row; the phone stacks three cells. */
export const roomGridClass =
  'grid grid-cols-12 items-center gap-x-6 max-compact:grid-cols-3 max-compact:gap-x-3';

const columns: Readonly<Record<RoomColumn, string>> = {
  name: 'col-span-4 min-w-0 max-compact:col-span-2',
  players: 'col-span-4 max-compact:col-span-2',
  status: 'col-span-2 max-compact:col-span-2',
  action:
    'col-span-2 max-compact:col-span-1 max-compact:col-start-3 max-compact:row-span-3 max-compact:row-start-1',
};

/** Grid placement of one column of the room list. */
export const roomColumnClass = (column: RoomColumn): string => columns[column];

const modes: Readonly<Record<RoomMode, string>> = {
  ranked: 'font-strong text-accent',
  casual: 'font-strong text-ink-muted',
};

/** Ranked reads in the accent color, casual stays muted. */
export const modeClass = (mode: RoomMode): string => modes[mode];

/** An open seat reads as a placeholder; a seated player as a name. */
export const seatClass = (seated: boolean): string =>
  seated ? 'text-ink' : 'text-ink-faint italic';
