import { eq, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { entries, entryMembers } from '../schema/entries';
import { events } from '../schema/events';
import { restrictions } from '../schema/guardian-links';
import { scopeTransaction, type TenantScope } from '../tenant-scope';
import { bumpTabAccountRevision } from './command-accounts';
import type { EntryEnrollmentWrite } from './entry-enrollment-write';
import type { EntryPersonRow } from './entry-person-rows';
import type { TabTransaction } from './tab-transaction';
const one = (rows: readonly unknown[]): void => {
  if (rows.length !== 1)
    throw createAppError(
      'INVARIANT',
      'Entry enrollment write did not affect one row',
    );
};
const apply = async (
  tx: TabTransaction,
  write: EntryEnrollmentWrite,
  scope: TenantScope,
  people: readonly EntryPersonRow[],
): Promise<void> => {
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
    case 'restrictions': {
      const person = people.find((person) =>
        person.limiting.some(
          (row) => row.guardianLinkId === write.where.guardianLinkId,
        ),
      );
      if (!person?.userId)
        throw createAppError('INVARIANT', 'Entry boundary subject is missing');
      await scopeTransaction(tx, { ...scope, subjectUserId: person.userId });
      one(
        await tx
          .update(restrictions)
          .set(write.set)
          .where(eq(restrictions.guardianLinkId, write.where.guardianLinkId))
          .returning({ id: restrictions.guardianLinkId }),
      );
      await scopeTransaction(tx, scope);
      return;
    }
  }
};
export const applyEntryEnrollmentWrites = async (
  tx: TabTransaction,
  writes: readonly EntryEnrollmentWrite[],
  scope: TenantScope,
  people: readonly EntryPersonRow[],
): Promise<void> => {
  for (const write of writes) await apply(tx, write, scope, people);
};
