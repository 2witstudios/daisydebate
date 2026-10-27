import { and, eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { messagingSocialCommands } from '../schema/messaging-social';
import {
  withContactPairs,
  type ContactAuthorizationFence,
} from '../contacts/fence';
import { dmRequestFrame } from './social-request';
import type { ContactReactions } from '../contacts/reactions';
import type { MessagingSocialStore } from './social-contracts';

/**
 * Messaging's DM requests over the shared Contacts fence; blocks are
 * Contacts' own (`../contacts/store`) and friendships Friends'.
 */
export function createMessagingSocialStore({
  database,
  authorize,
  reactions,
}: {
  readonly database: BunSQLDatabase;
  readonly authorize: ContactAuthorizationFence;
  readonly reactions: ContactReactions;
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
            ...dmRequestFrame(tx, input, rows, refresh, reactions.relations),
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
          }),
      ),
  };
}
