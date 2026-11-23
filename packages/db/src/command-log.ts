import { eq } from 'drizzle-orm';
import { createRefusal } from '@daisy/errors';
import { roomCommands } from './schema/room-commands';
import { roundCommands } from './schema/round-commands';
import type { Tx } from './tx';

/**
 * The aggregate command logs (Delivery 6947): `round_commands` and
 * `room_commands` each hold one row per accepted command, bound to the
 * aggregate's version, with no tenant scope. Tab's `action_history` and the
 * operator receipts are their own record kinds and do not use this.
 */
type CommandLog = typeof roundCommands | typeof roomCommands;

/** The values a stored row must carry; an undefined key is not bound. */
type Binding<Row> = { readonly [Key in keyof Row]?: unknown };

/**
 * A reused command id replays only when the stored row carries every bound
 * value; any other value refuses. A binding key left undefined is not bound.
 */
export function requireSameBinding<Row>(
  previous: Row,
  expected: Binding<Row>,
): void {
  for (const key of Object.keys(expected) as (keyof Row)[])
    if (expected[key] !== undefined && previous[key] !== expected[key])
      throw createRefusal('CONFLICT', 'command-conflict');
}

/**
 * The stored command for `commandId` in one aggregate's log, or null, read
 * under the command advisory lock its writer already holds.
 */
export async function storedCommand<Log extends CommandLog>(
  tx: Tx,
  log: Log,
  commandId: string,
  binding: Binding<Log['$inferSelect']>,
): Promise<Log['$inferSelect'] | null> {
  const table: CommandLog = log;
  const [previous] = (await tx
    .select()
    .from(table)
    .where(eq(table.commandId, commandId))) as Log['$inferSelect'][];
  if (!previous) return null;
  requireSameBinding(previous, binding);
  return previous;
}
