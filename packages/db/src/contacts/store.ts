import { and, eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { contactCommands } from '../schema/contacts';
import { contactBlockWriter, type ContactBlockCommand } from './block';
import {
  withContactPairs,
  type ContactAuthorizationFence,
  type ContactFact,
  type ContactInput,
} from './fence';
import type { ContactReactions } from './reactions';

/** One contact command (a block) over a locked contact pair. */
type ContactFrame = {
  readonly contacts: readonly ContactFact[];
  /** Whether the caller blocks the pair's other member. */
  readonly blocking: boolean | null;
  readonly readReceipt: (requestId: string) => Promise<{
    readonly kind: string;
    readonly digest: string;
  } | null>;
  readonly commitBlock: (
    command: ContactBlockCommand,
  ) => Promise<{ readonly blocked: boolean; readonly revision: number }>;
};
export type ContactStore = {
  readonly withContacts: <T>(
    input: ContactInput,
    work: (frame: ContactFrame) => Promise<T>,
  ) => Promise<T>;
};

/** Contacts' own commands over the shared fence, with the registered reactions. */
export function createContactStore({
  database,
  authorize,
  reactions,
}: {
  readonly database: BunSQLDatabase;
  readonly authorize: ContactAuthorizationFence;
  readonly reactions: ContactReactions;
}): ContactStore {
  return {
    withContacts: (input, work) =>
      withContactPairs(
        database,
        authorize,
        input,
        async (tx, { rows, contacts, refresh }) =>
          work({
            contacts,
            blocking:
              rows.length === 1
                ? rows[0]!.lowActorId === input.actorId
                  ? rows[0]!.lowBlocksHigh
                  : rows[0]!.highBlocksLow
                : null,
            async readReceipt(requestId) {
              await refresh();
              if (!idSchema.safeParse(requestId).success)
                throw createAppError('VALIDATION');
              const [receipt] = await tx
                .select({
                  kind: contactCommands.kind,
                  digest: contactCommands.digest,
                })
                .from(contactCommands)
                .where(
                  and(
                    eq(contactCommands.actorId, input.actorId),
                    eq(contactCommands.requestId, requestId),
                  ),
                );
              return receipt ?? null;
            },
            commitBlock: contactBlockWriter(
              tx,
              input,
              rows,
              refresh,
              reactions.onBlock,
            ),
          }),
      ),
  };
}
