import { and, inArray, isNull, max, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type { ResolutionCategory } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import { instrumented, type DatabaseEventSink } from './instrumented';
import {
  resolutionBankEntries,
  resolutionBankRevisions,
} from './schema/resolution-draws';

type NewEntry = {
  readonly id: string;
  readonly text: string;
  readonly category: ResolutionCategory;
  readonly difficulty: 'intro' | 'standard' | 'advanced';
  readonly locale: string;
  readonly provenance: string;
};

/**
 * The one way the curated bank changes (FMT-7): a new revision, numbered
 * after the latest, that adds entries and retires current ones in one
 * transaction under the bank lock. Nothing published is rewritten or
 * backdated; the database triggers refuse any other change. The future
 * operator API reaches the bank only through this operation.
 */
export const resolutionBankOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  publishResolutionBankRevision(input: {
    readonly note: string;
    readonly add: readonly NewEntry[];
    readonly retire: readonly string[];
  }): Promise<number> {
    if (!input.note.trim() || (!input.add.length && !input.retire.length))
      throw createAppError('VALIDATION');
    return instrumented(eventSink, 'publishResolutionBankRevision', () =>
      database.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended('resolution-bank', 59002))`,
        );
        const [latest] = await tx
          .select({ revision: max(resolutionBankRevisions.revision) })
          .from(resolutionBankRevisions);
        const revision = (latest?.revision ?? 0) + 1;
        await tx
          .insert(resolutionBankRevisions)
          .values({ revision, note: input.note.trim() });
        if (input.add.length)
          await tx.insert(resolutionBankEntries).values(
            input.add.map((entry) => ({
              ...entry,
              addedInRevision: revision,
            })),
          );
        if (input.retire.length) {
          const retired = await tx
            .update(resolutionBankEntries)
            .set({ retiredInRevision: revision })
            .where(
              and(
                inArray(resolutionBankEntries.id, [...input.retire]),
                isNull(resolutionBankEntries.retiredInRevision),
              ),
            )
            .returning({ id: resolutionBankEntries.id });
          if (retired.length !== new Set(input.retire).size)
            throw createAppError('CONFLICT', 'Only current entries retire');
        }
        return revision;
      }),
    );
  },
});
