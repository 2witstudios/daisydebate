import { and, eq, inArray } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError, isAppError } from '@daisy/errors';
import { buildChannelTopic } from '@daisy/protocol';
import { createAppendCollector, type AppendOutcome } from './append-collector';
import {
  retrySharedRead,
  withSharedMessagingAuthority,
} from './authority-frame';
import { readMessagingChannelFacts } from './social';
import {
  lockMessagingStream,
  readMessagingStream,
  advanceMessagingStream,
} from './stream';
import { messageRecord } from './message-record';
import {
  messagingMessages,
  messagingReceipts,
} from '../schema/messaging-messages';
import { outbox } from '../schema/outbox';
import type {
  MessagingAuthorizationFence,
  MessagingCreateSendPlan,
  MessagingMessageRecord,
  MessagingSendCommand,
  MessagingSendState,
} from './records';

export type MessagingSendAttempt = {
  readonly scope: {
    readonly actorId: string;
    readonly userId: string;
    readonly channelId: string;
  };
  readonly command: MessagingSendCommand;
  readonly authorize: MessagingAuthorizationFence;
  readonly admit: () => Promise<void>;
  readonly decide: (
    state: MessagingSendState,
  ) =>
    | MessagingCreateSendPlan
    | { readonly kind: 'replay'; readonly message: MessagingMessageRecord };
};
const expected = (error: unknown) =>
  isAppError(error) &&
  [
    'AUTHORIZATION',
    'NOT_FOUND',
    'CONFLICT',
    'VALIDATION',
    'RATE_LIMIT',
  ].includes(error.code);

/** One node-local collector, one authoritative transaction per batch, no limiter under a fence. */
export function createMessagingAppend(database: BunSQLDatabase) {
  const transaction = async (
    attempts: readonly MessagingSendAttempt[],
    final: boolean,
    admissions: readonly AppendOutcome<void>[] = [],
  ) =>
    retrySharedRead(database, (tx) =>
      withSharedMessagingAuthority(
        tx,
        attempts[0]!.scope,
        async ({ accounts }) => {
          const channelId = attempts[0]!.scope.channelId;
          const facts = await readMessagingChannelFacts(
            tx,
            attempts.map(({ scope }) => scope),
          );
          const authorized: AppendOutcome<void>[] = [];
          for (const [index, attempt] of attempts.entries()) {
            try {
              const fact = facts[index];
              if (!fact) throw createAppError('NOT_FOUND');
              await attempt.authorize(tx, attempt.scope, { fact, accounts });
              authorized.push({ value: undefined });
            } catch (error) {
              if (!expected(error)) throw error;
              authorized.push({ error });
            }
          }
          const locked = await (final
            ? lockMessagingStream(tx, channelId)
            : readMessagingStream(tx, channelId));
          const counters = { channelId, ...locked };
          const receipts = await tx
            .select()
            .from(messagingReceipts)
            .where(
              and(
                eq(messagingReceipts.channelId, channelId),
                inArray(
                  messagingReceipts.requestId,
                  attempts.map(({ command }) => command.requestId),
                ),
              ),
            );
          const receiptKey = (actor: string, request: string) =>
            `${actor}:${request}`;
          const byReceipt = new Map(
            receipts.map((row) => [
              receiptKey(row.actorId, row.requestId),
              row,
            ]),
          );
          const ids = [
            ...new Set(
              [
                ...receipts.map((row) => row.messageId),
                ...attempts.map(({ command }) => command.replyToMessageId),
              ].filter((id): id is string => typeof id === 'string'),
            ),
          ];
          const rows = ids.length
            ? await tx
                .select()
                .from(messagingMessages)
                .where(
                  and(
                    eq(messagingMessages.channelId, channelId),
                    inArray(messagingMessages.id, ids),
                  ),
                )
            : [];
          const messages = new Map(
            rows.map((row) => [row.id, messageRecord(row)]),
          );
          const creates: MessagingCreateSendPlan[] = [];
          const insertedReceipts: (typeof messagingReceipts.$inferInsert)[] =
            [];
          const outcomes: AppendOutcome<MessagingMessageRecord | null>[] = [];
          for (const [index, attempt] of attempts.entries()) {
            const authorization = authorized[index]!;
            if ('error' in authorization) {
              outcomes.push(authorization);
              continue;
            }
            const { command, scope } = attempt;
            const receipt =
              byReceipt.get(receiptKey(scope.actorId, command.requestId)) ??
              null;
            const state: MessagingSendState = {
              counters,
              receipt,
              existingMessage: receipt?.messageId
                ? (messages.get(receipt.messageId) ?? null)
                : null,
              reply: command.replyToMessageId
                ? (messages.get(command.replyToMessageId) ?? null)
                : null,
            };
            try {
              // Replay/invalid reuse has precedence over admission, even after Redis refusal/outage.
              if (!receipt && !final) {
                attempt.decide(state);
                outcomes.push({ value: null });
                continue;
              }
              if (
                !receipt &&
                (counters.messageSequence === Number.MAX_SAFE_INTEGER ||
                  counters.changeVersion === Number.MAX_SAFE_INTEGER)
              )
                throw createAppError(
                  'INFRASTRUCTURE',
                  'Messaging stream exhausted',
                );
              const plan = attempt.decide(state);
              if (plan.kind === 'replay') {
                outcomes.push({ value: plan.message });
                continue;
              }
              const admission = admissions[index]!;
              if ('error' in admission) {
                outcomes.push(admission);
                continue;
              }
              if (
                plan.message.channelId !== channelId ||
                plan.message.authorActorId !== scope.actorId ||
                plan.message.sequence !== counters.messageSequence + 1 ||
                plan.message.changeVersion !== counters.changeVersion + 1 ||
                plan.receipt.messageId !== plan.message.id ||
                plan.message.text !== command.text
              )
                throw new Error('Invalid append decision');
              creates.push(plan);
              const row = {
                channelId,
                actorId: scope.actorId,
                requestId: command.requestId,
                ...plan.receipt,
              };
              insertedReceipts.push(row);
              byReceipt.set(receiptKey(scope.actorId, command.requestId), row);
              messages.set(plan.message.id, plan.message);
              counters.messageSequence = plan.message.sequence;
              counters.changeVersion = plan.message.changeVersion;
              outcomes.push({ value: plan.message });
            } catch (error) {
              if (!expected(error)) throw error;
              outcomes.push({ error });
            }
          }
          if (creates.length) {
            // Checked allocation precedes all child writes; every unexpected failure rolls back the batch.
            await advanceMessagingStream(tx, channelId, locked, {
              messages: creates.length,
              changes: creates.length,
            });
            await tx
              .insert(messagingMessages)
              .values(
                creates.map(({ message }) => ({
                  ...message,
                  createdAt: new Date(message.createdAt),
                  editedAt: null,
                  removedAt: null,
                })),
              );
            await tx.insert(messagingReceipts).values(insertedReceipts);
            await tx
              .insert(outbox)
              .values(
                creates.map(({ doorbell }) => ({
                  topic: buildChannelTopic(channelId),
                  kind: 'channel.changed',
                  version: 1,
                  payload: doorbell,
                })),
              );
          }
          return outcomes;
        },
        {
          additionalActors: attempts.map(({ scope }) => scope.actorId),
          beforeChannel: async () => {},
        },
      ),
    );
  const collector = createAppendCollector<
    MessagingSendAttempt,
    MessagingMessageRecord
  >({
    execute: async (_channel, attempts) => {
      const preflight = await transaction(attempts, false);
      const admissions = await Promise.all(
        attempts.map(async (attempt, index): Promise<AppendOutcome<void>> => {
          const result = preflight[index]!;
          if ('error' in result) return result;
          if (result.value !== null)
            return {
              error: createAppError(
                'INFRASTRUCTURE',
                'Replay changed during admission',
              ),
            };
          try {
            await attempt.admit();
            return { value: undefined };
          } catch (error) {
            return { error };
          }
        }),
      );
      // Final lookup always runs, including preflight failures: no saved decision grants access.
      const results = await transaction(attempts, true, admissions);
      return results.map((result) => {
        if ('error' in result) return result;
        if (!result.value) throw new Error('Missing final append outcome');
        return { value: result.value };
      });
    },
  });
  return {
    send: (attempt: MessagingSendAttempt) =>
      collector.append(
        attempt.scope.channelId,
        attempt.scope.actorId,
        attempt,
        new TextEncoder().encode(JSON.stringify(attempt.command)).byteLength,
      ),
  };
}
