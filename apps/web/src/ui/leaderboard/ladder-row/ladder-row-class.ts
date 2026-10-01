import type { Change } from '../../../features/leaderboard/ladder-view';

export type LadderColumn =
  'rank' | 'name' | 'band' | 'rating' | 'record' | 'move';

/** One grid for the header and every row; the phone drops band and record. */
export const ladderGridClass =
  'grid grid-cols-12 items-center gap-x-4 max-compact:gap-x-2';

const columns: Readonly<Record<LadderColumn, string>> = {
  rank: 'col-span-1',
  name: 'col-span-4 min-w-0 max-compact:col-span-6',
  band: 'col-span-2 max-compact:hidden',
  rating: 'col-span-2 max-compact:col-span-2',
  record: 'col-span-2 max-compact:hidden',
  move: 'col-span-1 max-compact:col-span-3',
};

/** Grid placement of one column of the ladder. */
export const ladderColumnClass = (column: LadderColumn): string =>
  columns[column];

const moveTones: Readonly<Record<Change['kind'], string>> = {
  up: 'text-online',
  down: 'text-ink-muted',
  flat: 'text-ink-faint',
  none: 'text-ink-faint',
};

/** Up moves read green; down and flat stay quiet (arrows carry the sign). */
export const moveClass = (kind: Change['kind']): string => moveTones[kind];

/** The top three ranks read gold; everyone else stays muted. */
export const rankClass = (rank: number | null): string =>
  rank !== null && rank <= 3 ? 'text-gold' : 'text-ink-muted';

const rowBase =
  'px-5 py-3 min-h-12 text-base text-ink no-underline hover:no-underline max-compact:px-4';

/** The row's surface: selected, the viewer's own, or plain. */
export const rowClass = (state: { selected: boolean; me: boolean }): string =>
  `${rowBase} ${state.selected ? 'bg-surface-overlay' : state.me ? 'bg-accent-soft' : 'hover:bg-surface-raised'}`;
