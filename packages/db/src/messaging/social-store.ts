import { and, eq } from 'drizzle-orm';
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
import type { TxSource } from '../tx';
import { readOpenDmFact, type MessagingChannelFact } from './social';

type DmRequestFence = (
  ...args: [
    ...Parameters<ContactAuthorizationFence>,
    MessagingChannelFact | null,
  ]
) => Promise<void>;

/**
 * Messaging's DM requests over the shared Contacts fence; blocks are
 * Contacts' own (`../contacts/store`) and friendships Friends'.
 */
export function createMessagingSocialStore({
  database,
  authorize,
  reactions,
}: {
  readonly database: TxSource;
  readonly authorize: DmRequestFence;
  readonly reactions: ContactReactions;
}): MessagingSocialStore {
  return {
    withContacts: (input, work) =>
      withContactPairs(
        database,
        async (tx, command, facts) => {
          const [pair] = facts.contacts;
          if (facts.contacts.length !== 1 || !pair)
            throw createAppError('VALIDATION');
          if (pair.blocked) throw createAppError('AUTHORIZATION');
          await authorize(
            tx,
            command,
            facts,
            await readOpenDmFact(tx, command.actorId, pair),
          );
        },
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
