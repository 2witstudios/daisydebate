import { and, eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { messagingSocialCommands } from '../schema/messaging-social';
import {
  withContactPairs,
  type ContactAuthorizationFence,
} from '../contacts/fence';
import { contactBlockWriter } from './social-block';
import { dmRequestFrame } from './social-request';
import type { MessagingSocialStore } from './social-contracts';

/**
 * Messaging's contact commands (DM requests and blocks) over the shared
 * Contacts fence; friendships live in their own store (`../friends`).
 */
export function createMessagingSocialStore({
  database,
  authorize,
}: {
  readonly database: BunSQLDatabase;
  readonly authorize: ContactAuthorizationFence;
}): MessagingSocialStore {
  return {
    withContacts: (input, work) =>
      withContactPairs(
        database,
        authorize,
        input,
        async (tx, { rows, contacts, refresh }) =>
          work({
            contacts,
            ...dmRequestFrame(tx, input, rows, refresh),
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
                  kind: messagingSocialCommands.kind,
                  digest: messagingSocialCommands.digest,
                  channelId: messagingSocialCommands.resultChannelId,
                })
                .from(messagingSocialCommands)
                .where(
                  and(
                    eq(messagingSocialCommands.actorId, input.actorId),
                    eq(messagingSocialCommands.requestId, requestId),
                  ),
                );
              return receipt ?? null;
            },
            commitBlock: contactBlockWriter(tx, input, rows, refresh),
          }),
      ),
  };
}
