import { eq, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { entries, entryMembers } from '../schema/entries';
import { events } from '../schema/events';
import { bumpTabAccountRevision } from './command-accounts';
import type { EntryEnrollmentWrite } from './entry-enrollment-write';
import type { Tx } from '../tx';
const one = (rows: readonly unknown[]): void => {
  if (rows.length !== 1)
    throw createAppError(
      'INVARIANT',
      'Entry enrollment write did not affect one row',
    );
};
const apply = async (tx: Tx, write: EntryEnrollmentWrite): Promise<void> => {
  switch (write.table) {
    case 'entries':
      if (write.op === 'insert') {
        await tx.insert(entries).values(write.row);
        return;
      }
      return one(
        await tx
          .update(entries)
          .set({ ...write.set, version: sql`${entries.version} + 1` })
          .where(eq(entries.id, write.where.id))
          .returning({ id: entries.id }),
      );
    case 'entry_members':
      await tx.insert(entryMembers).values(write.row);
      return;
    case 'events':
      return one(
        await tx
          .update(events)
          .set(write.set)
          .where(eq(events.id, write.where.id))
          .returning({ id: events.id }),
      );
    case 'users':
      return bumpTabAccountRevision(tx, write.id);
  }
};
export const applyEntryEnrollmentWrites = async (
  tx: Tx,
  writes: readonly EntryEnrollmentWrite[],
): Promise<void> => {
  for (const write of writes) await apply(tx, write);
};
