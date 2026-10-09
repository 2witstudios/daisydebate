import { and, eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { lockAuthorizationActors } from '../authorization';
import {
  messagingContactPairs,
  messagingSocialCommands,
} from '../schema/messaging-social';
import { contactBlockWriter } from './social-block';
import { dmRequestFrame } from './social-request';
import type {
  MessagingSocialAuthorizationFence,
  MessagingSocialStore,
} from './social-contracts';

/** All proposed accounts precede canonically ordered pair fences, including absent pairs. */
export function createMessagingSocialStore({
  database,
  authorize,
}: {
  readonly database: BunSQLDatabase;
  readonly authorize: MessagingSocialAuthorizationFence;
}): MessagingSocialStore {
  return {
    async withContacts(input, work) {
      const members = [...input.memberActorIds].sort();
      if (
        !idSchema.safeParse(input.userId).success ||
        !members.includes(input.actorId) ||
        new Set(members).size !== members.length ||
        members.length < 2
      )
        throw createAppError('VALIDATION');
      // A technical bound prevents unbounded SQL construction; product bounds live at the edge.
      if ((members.length * (members.length - 1)) / 2 > 65535)
        throw createAppError('VALIDATION');
      return database.transaction(async (tx) => {
        const accounts = await lockAuthorizationActors(tx, members, {
          maxActors: 65535,
        });
        if (
          accounts.some(
            (account) =>
              account === null ||
              (account.actorId !== input.actorId && account.erased),
          )
        )
          throw createAppError('NOT_FOUND');
        const rows: (typeof messagingContactPairs.$inferSelect)[] = [];
        for (const [index, low] of members.entries())
          for (const high of members.slice(index + 1)) {
            await tx
              .insert(messagingContactPairs)
              .values({ lowActorId: low, highActorId: high })
              .onConflictDoNothing();
            const [pair] = await tx
              .select()
              .from(messagingContactPairs)
              .where(
                and(
                  eq(messagingContactPairs.lowActorId, low),
                  eq(messagingContactPairs.highActorId, high),
                ),
              )
              .for('update');
            if (!pair) throw createAppError('NOT_FOUND');
            rows.push(pair);
          }
        const contacts = rows.map((pair) => ({
          lowActorId: pair.lowActorId,
          highActorId: pair.highActorId,
          blocked: pair.lowBlocksHigh || pair.highBlocksLow,
          revision: pair.revision,
        }));
        const refresh = () => authorize(tx, input, { contacts, accounts });
        await refresh();
        return work({
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
        });
      });
    },
  };
}
