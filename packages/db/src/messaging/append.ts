import { authorizationAgeFacts } from '../authorization-age-batch';
import { and, eq, inArray, sql } from 'drizzle-orm';
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
import { messagingFiles } from '../schema/messaging-files';
import { fileDeletionValues } from '../messaging-files/frame';
import { outbox } from '../schema/outbox';
import type {
  MessagingAuthorizationFence,
  MessagingCreateSendPlan,
  MessagingMessageRecord,
  MessagingSendCommand,
  MessagingSendState,
  MessagingMutationCommand,
  MessagingMutationState,
  MessagingMutationPlan,
} from './records';

type Attempt = {
  readonly scope: {
    readonly actorId: string;
    readonly userId: string;
    readonly channelId: string;
  };
  readonly authorize: MessagingAuthorizationFence;
  readonly admit: () => Promise<void>;
};
export type MessagingSendAttempt = Attempt & {
  readonly command: MessagingSendCommand;
  readonly decide: (
    state: MessagingSendState,
  ) =>
    | MessagingCreateSendPlan
    | { readonly kind: 'replay'; readonly message: MessagingMessageRecord };
};
export type MessagingMutationAttempt = Attempt & {
  readonly command: MessagingMutationCommand;
  readonly decide: (
    state: MessagingMutationState,
  ) =>
    | (MessagingMutationPlan & { readonly kind: 'change' })
    | { readonly kind: 'replay'; readonly message: MessagingMessageRecord };
};
type ContentAttempt = MessagingSendAttempt | MessagingMutationAttempt;
const isMutation = (
  attempt: ContentAttempt,
): attempt is MessagingMutationAttempt => 'kind' in attempt.command;
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
    attempts: readonly ContentAttempt[],
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
          const locked = await (final
            ? lockMessagingStream(tx, channelId)
            : readMessagingStream(tx, channelId));
          const counters = { channelId, ...locked };
          const nowRows = await tx.execute(
            sql`select clock_timestamp() as now`,
          );
          const now = new Date(nowRows[0]!.now as string | Date).toISOString();
          const policyAccounts = await authorizationAgeFacts(
            tx,
            accounts.filter((account) => account !== null),
            now,
          );
          const authorized: AppendOutcome<void>[] = [];
          for (const [index, attempt] of attempts.entries()) {
            try {
              const fact = facts[index];
              if (!fact) throw createAppError('NOT_FOUND');
              await attempt.authorize(tx, attempt.scope, {
                fact,
                accounts,
                policyAccounts,
              });
              authorized.push({ value: undefined });
            } catch (error) {
              if (!expected(error)) throw error;
              authorized.push({ error });
            }
          }
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
                ...attempts.map((attempt) =>
                  isMutation(attempt)
                    ? attempt.command.messageId
                    : attempt.command.replyToMessageId,
                ),
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
          const changed = new Map<string, MessagingMessageRecord>();
          const removed = new Set<string>();
          const bells: MessagingCreateSendPlan['doorbell'][] = [];
          const replayed = new Set<number>();
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
              reply:
                !isMutation(attempt) && attempt.command.replyToMessageId
                  ? (messages.get(attempt.command.replyToMessageId) ?? null)
                  : null,
            };
            const decide = () =>
              isMutation(attempt)
                ? attempt.decide({
                    counters,
                    receipt,
                    message: messages.get(attempt.command.messageId) ?? null,
                  })
                : attempt.decide(state);
            try {
              // Replay/invalid reuse has precedence over admission, even after Redis refusal/outage.
              if (!receipt && !final) {
                decide();
                outcomes.push({ value: null });
                continue;
              }
              if (
                !receipt &&
                ((!isMutation(attempt) &&
                  counters.messageSequence === Number.MAX_SAFE_INTEGER) ||
                  counters.changeVersion === Number.MAX_SAFE_INTEGER)
              )
                throw createAppError(
                  'INFRASTRUCTURE',
                  'Messaging stream exhausted',
                );
              const plan = decide();
              if (plan.kind === 'replay') {
                replayed.add(index);
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
                plan.message.changeVersion !== counters.changeVersion + 1
              )
                throw new Error('Invalid append decision');
              const payloadDigest =
                plan.kind === 'create'
                  ? plan.receipt.payloadDigest
                  : plan.payloadDigest;
              const row = {
                channelId,
                actorId: scope.actorId,
                requestId: command.requestId,
                messageId: plan.message.id,
                payloadDigest,
              };
              if (plan.kind === 'create') {
                if (
                  isMutation(attempt) ||
                  plan.message.sequence !== counters.messageSequence + 1 ||
                  plan.message.text !== attempt.command.text ||
                  plan.receipt.messageId !== plan.message.id
                )
                  throw new Error('Invalid send decision');
                creates.push(plan);
                counters.messageSequence = plan.message.sequence;
              } else {
                if (
                  !isMutation(attempt) ||
                  plan.message.id !== attempt.command.messageId
                )
                  throw new Error('Invalid mutation decision');
                changed.set(plan.message.id, plan.message);
                if (plan.message.removedAt !== null)
                  removed.add(plan.message.id);
              }
              insertedReceipts.push(row);
              byReceipt.set(receiptKey(scope.actorId, command.requestId), row);
              messages.set(plan.message.id, plan.message);
              bells.push(plan.doorbell);
              counters.changeVersion = plan.message.changeVersion;
              outcomes.push({ value: plan.message });
            } catch (error) {
              if (!expected(error)) throw error;
              outcomes.push({ error });
            }
          }
          if (bells.length) {
            await advanceMessagingStream(tx, channelId, locked, {
              messages: creates.length,
              changes: bells.length,
            });
            if (creates.length)
              await tx.insert(messagingMessages).values(
                creates.map(({ message }) => {
                  const current = messages.get(message.id)!;
                  return {
                    ...current,
                    createdAt: new Date(current.createdAt),
                    editedAt: current.editedAt
                      ? new Date(current.editedAt)
                      : null,
                    removedAt: current.removedAt
                      ? new Date(current.removedAt)
                      : null,
                  };
                }),
              );
            const existingChanges = [...changed.values()].filter(
              (message) =>
                !creates.some((plan) => plan.message.id === message.id),
            );
            if (existingChanges.length)
              await tx.execute(sql`
              update messaging_messages m set text=v.text, change_version=v."changeVersion", edited_at=v."editedAt", removed_at=v."removedAt"
              from jsonb_to_recordset(${JSON.stringify(existingChanges)}::text::jsonb) as v(id text,text text,"changeVersion" bigint,"editedAt" timestamptz,"removedAt" timestamptz)
              where m.channel_id=${channelId} and m.id=v.id
            `);
            if (removed.size) {
              await tx
                .update(messagingFiles)
                .set(fileDeletionValues)
                .where(
                  and(
                    eq(messagingFiles.channelId, channelId),
                    inArray(messagingFiles.messageId, [...removed]),
                    eq(messagingFiles.lifecycle, 'attached'),
                  ),
                );
              await tx
                .update(messagingReceipts)
                .set({ payloadDigest: null })
                .where(
                  and(
                    eq(messagingReceipts.channelId, channelId),
                    inArray(messagingReceipts.messageId, [...removed]),
                  ),
                );
            }
            await tx.insert(messagingReceipts).values(
              insertedReceipts.map((row) => ({
                ...row,
                payloadDigest:
                  row.messageId && removed.has(row.messageId)
                    ? null
                    : row.payloadDigest,
              })),
            );
            await tx.insert(outbox).values(
              bells.map((doorbell) => ({
                topic: buildChannelTopic(channelId),
                kind: 'channel.changed',
                version: 1,
                payload: doorbell,
              })),
            );
          }
          // All response bytes come from final scratch state, including earlier accepted sends/edits.
          for (const [index, outcome] of outcomes.entries()) {
            if ('error' in outcome || !outcome.value) continue;
            const current = messages.get(outcome.value.id)!;
            outcomes[index] =
              replayed.has(index) &&
              (current.text === null || current.removedAt !== null)
                ? { error: createAppError('NOT_FOUND') }
                : { value: current };
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
    ContentAttempt,
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
  const enqueue = (attempt: ContentAttempt) =>
    collector.append(
      attempt.scope.channelId,
      attempt.scope.actorId,
      attempt,
      new TextEncoder().encode(JSON.stringify(attempt.command)).byteLength,
    );
  return { send: enqueue, mutate: enqueue };
}
