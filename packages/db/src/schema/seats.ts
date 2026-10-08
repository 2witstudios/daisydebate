import type { DebateRole } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import { integer, text } from 'drizzle-orm/pg-core';
import { actors } from './actors';

/**
 * The columns every seat table carries (ADR 0058 §2, §5a): who holds the
 * seat, at which role and slot. The owning row's id and the seat's owner
 * differ per table, so each table names its own id and owner columns and
 * spreads these three.
 */

/** The actor holding the seat; a seat never dangles. */
export const seatActorId = () =>
  text('actor_id')
    .notNull()
    .references(() => actors.id, { onDelete: 'restrict' });

/** The seat's role in the debate. */
export const seatRole = () => text('role').$type<DebateRole>().notNull();

/** The slot within the role: exactly one occupant per (owner, role, slot). */
export const seatSlot = () => integer('slot').notNull().default(0);

/** The slot CHECK both seat tables declare: a slot is never negative. */
export const seatSlotCheck = (slotColumn: unknown) => sql`${slotColumn} >= 0`;
