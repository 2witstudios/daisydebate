import { createAppError } from '@daisy/errors';
import type { SeatKind, SeatRef, SideKey } from '@daisy/protocol/seats';
import { asc, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

/**
 * A seat as its row stores it (TAB-6.2): its kind, the side a side's seat
 * belongs to, and its slot. `seat_kind` and `side` agree by the seat tables'
 * `_side_check`, so a row that breaks it is corruption.
 */
export type SeatColumns = {
  readonly seatKind: SeatKind;
  readonly side: SideKey | null;
  readonly slot: number;
};

/** The seat a row holds. */
export const seatOfColumns = (row: SeatColumns): SeatRef => {
  switch (row.seatKind) {
    case 'side':
      if (row.side === null)
        throw createAppError('INVARIANT', 'A side seat names its side');
      return { kind: 'side', side: row.side, slot: row.slot };
    case 'speaker':
    case 'judge':
    case 'moderator':
      return { kind: row.seatKind, slot: row.slot };
  }
};

/** The columns a seat is stored in. */
export const columnsOfSeat = (seat: SeatRef): SeatColumns => ({
  seatKind: seat.kind,
  side: seat.kind === 'side' ? seat.side : null,
  slot: seat.slot,
});

/**
 * The stable order seat rows are read in: by side key or seat kind, then
 * kind, then slot. Over the two-sided preset it is the order the old role
 * column gave (affirmative, judge, negative), so every reader's order holds.
 */
export const seatRowOrder = (table: {
  readonly seatKind: PgColumn;
  readonly side: PgColumn;
  readonly slot: PgColumn;
}): SQL[] => [
  asc(sql`coalesce(${table.side}, ${table.seatKind})`),
  asc(table.seatKind),
  asc(table.slot),
];

/**
 * The SQL spelling of `isDebatingSeat` (a competitor's seat: a side's or an
 * unsided speaker's) over a `seat_kind` column or expression.
 */
export const isDebatingSeatSql = (seatKind: PgColumn | SQL): SQL =>
  sql`${seatKind} in ('side', 'speaker')`;
