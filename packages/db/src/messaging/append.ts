import { authorizationAgeFacts } from '../authorization-age-batch';
import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { createAppendCollector, type AppendOutcome } from './append-collector';
import {
  retrySharedRead,
  withSharedMessagingAuthority,
} from './authority-frame';
import { readMessagingChannelFacts } from './social';
import { lockMessagingStream, readMessagingStream } from './stream';
import { readAppendScratch } from './append-read';
import { applyAppendDecisions, finalizeAppend } from './append-decisions';
import { writeAppend } from './append-write';
import { expectedAppendError, type ContentAttempt } from './append-contracts';
import type { MessagingMessageRecord } from './records';
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
              if (!expectedAppendError(error)) throw error;
              authorized.push({ error });
            }
          }
          const scratch = await readAppendScratch(
            tx,
            channelId,
            attempts.filter((_attempt, index) => 'value' in authorized[index]!),
            locked,
          );
          const outcomes = applyAppendDecisions(
            attempts,
            authorized,
            admissions,
            final,
            scratch,
          );
          await writeAppend(tx, scratch);
          return finalizeAppend(outcomes, scratch);
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
