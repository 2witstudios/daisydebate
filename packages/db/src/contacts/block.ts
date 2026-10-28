import { and, eq } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { contactCommands, contactPairs } from '../schema/contacts';
import type { ContactInput } from './fence';
import type { ContactReactions, ContactTransaction } from './reactions';

/** A block (or unblock) of the pair's other member, and its result. */
export type ContactBlockCommand = {
  readonly requestId: string;
  readonly blocked: boolean;
  readonly digest: string;
  readonly now: string;
};

/**
 * Sets the caller's block on the locked pair, advances its revision, writes
 * Contacts' own receipt, then runs every registered block reaction in the
 * same transaction (ADR 0061, ADR 0072).
 */
export function contactBlockWriter(
  tx: ContactTransaction,
  input: ContactInput,
  rows: readonly (typeof contactPairs.$inferSelect)[],
  authorize: () => Promise<void>,
  onBlock: ContactReactions['onBlock'],
) {
  return async (
    command: ContactBlockCommand,
  ): Promise<{ readonly blocked: boolean; readonly revision: number }> => {
    await authorize();
    if (rows.length !== 1) throw createAppError('VALIDATION');
    const pair = rows[0]!;
    const revision = pair.revision + 1;
    if (!Number.isSafeInteger(revision)) throw createAppError('CONFLICT');
    const ownsLow = pair.lowActorId === input.actorId;
    const [updated] = await tx
      .update(contactPairs)
      .set({
        revision,
        ...(ownsLow
          ? { lowBlocksHigh: command.blocked }
          : { highBlocksLow: command.blocked }),
      })
      .where(
        and(
          eq(contactPairs.lowActorId, pair.lowActorId),
          eq(contactPairs.highActorId, pair.highActorId),
        ),
      )
      .returning();
    if (!updated) throw createAppError('NOT_FOUND');
    await tx.insert(contactCommands).values({
      actorId: input.actorId,
      counterpartActorId: ownsLow ? pair.highActorId : pair.lowActorId,
      requestId: command.requestId,
      kind: 'contact.block',
      digest: command.digest,
      createdAt: new Date(command.now),
    });
    for (const react of onBlock) await react(tx, pair, command.blocked);
    return {
      blocked: ownsLow ? updated.lowBlocksHigh : updated.highBlocksLow,
      revision,
    };
  };
}
