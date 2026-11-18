import { seatKinds, type SeatKind, type SideKey } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import { check, integer, text, type PgColumn } from 'drizzle-orm/pg-core';
import { actors } from './actors';
import { isSideKeyOrNull, oneOf } from './columns';

/**
 * The columns every seat table carries (ADR 0058 §2, §5a, TAB-6.2): who holds
 * the seat, its kind, the side a side's seat belongs to, and its slot. The
 * owning row's id and the seat's owner differ per table, so each table names
 * its own id and owner columns and spreads these.
 */

/** The actor holding the seat; a seat never dangles. */
export const seatActorId = () =>
  text('actor_id')
    .notNull()
    .references(() => actors.id, { onDelete: 'restrict' });

/** The seat's kind: a side's, an unsided speaker's, a judge's or a moderator's. */
export const seatKindColumn = () =>
  text('seat_kind').$type<SeatKind>().notNull();

/** The side a side's seat belongs to; null for every other kind. */
export const seatSideColumn = () => text('side').$type<SideKey>();

/** The slot within the seat's kind (and side): one occupant per seat. */
export const seatSlot = () => integer('slot').notNull().default(0);

/**
 * The CHECKs both seat tables declare: a known kind, a side exactly on a
 * side's seat and spelled as a side key, and a slot that is never negative.
 */
export const seatChecks = (
  table: string,
  columns: {
    readonly seatKind: PgColumn;
    readonly side: PgColumn;
    readonly slot: PgColumn;
  },
) => [
  check(`${table}_seat_kind_check`, oneOf(columns.seatKind, seatKinds)),
  check(
    `${table}_side_check`,
    sql`(${columns.side} is not null) = (${columns.seatKind} = 'side') and (${isSideKeyOrNull(columns.side)})`,
  ),
  check(`${table}_slot_check`, sql`${columns.slot} >= 0`),
];
