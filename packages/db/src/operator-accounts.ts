import { createAppError } from '@daisy/errors';
import {
  betaAccessCommandResultSchema,
  betaAccessStates,
  idSchema,
  type BetaAccessCommandResult,
  type BetaAccessState,
} from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { z } from 'zod';
import { lockAuthorizationActors } from './authorization';
import type { authorizationAccountFact } from './authorization-account';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { appendSessionRevokedFor } from './session-revoked';

type Database = Pick<BunSQLDatabase, 'transaction' | 'execute'>;
type AccountFact = NonNullable<ReturnType<typeof authorizationAccountFact>>;

const instant = z
  .union([z.date(), z.string()])
  .transform((value) => new Date(value).toISOString());
const accountRow = z.object({
  user_id: idSchema,
  username: z.string().nullable(),
  state: z.enum(betaAccessStates),
  revision: z.coerce.number().int().positive(),
  requested_at: instant,
  decided_at: instant.nullable(),
});

export type OperatorAccountRow = {
  readonly userId: string;
  readonly username: string | null;
  readonly accessState: BetaAccessState;
  readonly accessRevision: number;
  readonly requestedAt: string;
  readonly decidedAt: string | null;
};

/** The pure decision and authority, injected so this adapter decides nothing itself. */
export type BetaAccessCommandInput = {
  readonly commandId: string;
  readonly serviceId: string;
  readonly operatorRef: string;
  readonly targetUserId: string;
  readonly desired: 'approved' | 'revoked';
  readonly expectedRevision: number;
  /** SHA3-256 of the command's semantic identity (ADR 0079). */
  readonly requestDigest: string;
  readonly adminAuditHead: string;
  readonly nextId: () => string;
  readonly authorize: (target: AccountFact | null) => boolean;
  readonly decide: (
    current: {
      readonly state: BetaAccessState;
      readonly revision: number;
    } | null,
    ageBand: AccountFact['ageBand'],
  ) =>
    | {
        readonly kind: 'changed';
        readonly from: BetaAccessState;
        readonly to: 'approved' | 'revoked';
        readonly revision: number;
      }
    | {
        readonly kind: 'unchanged';
        readonly state: BetaAccessState;
        readonly revision: number;
      }
    | {
        readonly kind: 'refused';
        readonly reason: 'not-found' | 'stale' | 'age-required';
      };
};

export type BetaAccessCommandOutcome =
  | { readonly kind: 'applied'; readonly result: BetaAccessCommandResult }
  | { readonly kind: 'replayed'; readonly result: BetaAccessCommandResult };

/**
 * ADR 0079's operator account operations. A beta access command runs in one
 * transaction under the target's account fence: its receipt is looked up
 * first (the same digest replays the stored result, a different one
 * conflicts), then authority and the transition are decided on the fresh
 * fact, and state, revision, audit event, receipt, owed mail and the
 * revocation push commit together. A refusal writes nothing.
 */
export function operatorAccountOperations({
  database,
  eventSink,
}: {
  readonly database: Database;
  readonly eventSink?: DatabaseEventSink | undefined;
}) {
  return {
    /** One keyset page, newest request first, `userId` breaking ties. */
    listOperatorAccounts: (input: {
      readonly access: BetaAccessState;
      readonly limit: number;
      readonly after: {
        readonly requestedAt: string;
        readonly userId: string;
      } | null;
    }): Promise<readonly OperatorAccountRow[]> =>
      instrumented(eventSink, 'listOperatorAccounts', async () => {
        if (
          !Number.isSafeInteger(input.limit) ||
          input.limit < 1 ||
          input.limit > 101
        )
          throw createAppError('VALIDATION');
        const after = input.after
          ? sql`and (b.requested_at, b.user_id) < (${input.after.requestedAt}::timestamptz, ${input.after.userId})`
          : sql``;
        const rows =
          (await database.execute(sql`select b.user_id, u.username, b.state,
            b.revision, b.requested_at, b.decided_at
          from account_beta_access b join users u on u.id = b.user_id
          where b.state = ${input.access} and u.deleted_at is null ${after}
          order by b.requested_at desc, b.user_id desc
          limit ${input.limit}`)) as unknown as unknown[];
        return rows.map((row) => {
          const parsed = accountRow.parse(row);
          return {
            userId: parsed.user_id,
            username: parsed.username,
            accessState: parsed.state,
            accessRevision: parsed.revision,
            requestedAt: parsed.requested_at,
            decidedAt: parsed.decided_at,
          };
        });
      }),
    runBetaAccessCommand: (
      input: BetaAccessCommandInput,
    ): Promise<BetaAccessCommandOutcome> =>
      instrumented(eventSink, 'runBetaAccessCommand', () =>
        database.transaction(async (tx) => {
          const [actor] = (await tx.execute(
            sql`select id from actors where user_id = ${input.targetUserId} and kind = 'human'`,
          )) as unknown as { id: string }[];
          const [fact] = actor
            ? await lockAuthorizationActors(tx, [actor.id], { maxActors: 1 })
            : [null];
          const [receipt] = (await tx.execute(sql`select request_digest, result
            from operator_command_receipts where command_id = ${input.commandId}`)) as unknown as {
            request_digest: string;
            result: unknown;
          }[];
          if (receipt) {
            if (receipt.request_digest !== input.requestDigest)
              throw createAppError('CONFLICT');
            return {
              kind: 'replayed',
              result: betaAccessCommandResultSchema.parse(receipt.result),
            };
          }
          if (!fact || fact.erased || fact.userId !== input.targetUserId)
            throw createAppError('NOT_FOUND');
          if (!input.authorize(fact)) throw createAppError('AUTHORIZATION');
          const decision = input.decide(fact.beta, fact.ageBand);
          if (decision.kind === 'refused')
            throw createAppError(
              (
                {
                  stale: 'CONFLICT',
                  'not-found': 'NOT_FOUND',
                  // ISSUE-664: approval needs a durable 16+ age record first.
                  'age-required': 'INVARIANT',
                } as const
              )[decision.reason],
            );
          const principal = `operator:${input.serviceId}/${input.operatorRef}`;
          const changed = decision.kind === 'changed';
          const result: BetaAccessCommandResult = {
            commandId: input.commandId,
            outcome: changed ? 'changed' : 'unchanged',
            accessState: changed ? decision.to : decision.state,
            accessRevision: decision.revision,
            mail: changed && decision.to === 'approved' ? 'queued' : 'none',
          };
          if (changed) {
            await tx.execute(sql`update account_beta_access set state = ${decision.to},
                revision = ${decision.revision}, decided_at = now()
              where user_id = ${input.targetUserId}`);
            // The account fact's revision moves, so live realtime sessions re-check.
            await tx.execute(
              sql`update users set version = version + 1 where id = ${input.targetUserId}`,
            );
            await tx.execute(sql`insert into account_access_events
                (id, user_id, command_id, from_state, to_state, revision, principal)
              values (${input.nextId()}, ${input.targetUserId}, ${input.commandId},
                ${decision.from}, ${decision.to}, ${decision.revision}, ${principal})`);
            if (decision.to === 'approved')
              await tx.execute(sql`insert into mail_intents
                  (id, purpose, recipient_user_id, dedupe_key, next_attempt_at)
                values (${input.nextId()}, 'beta-approved', ${input.targetUserId},
                  ${`beta-approved:${input.commandId}`}, now())`);
            else
              await appendSessionRevokedFor(
                tx,
                input.targetUserId,
                eventSink,
                'runBetaAccessCommand',
              );
          }
          await tx.execute(sql`insert into operator_command_receipts
              (command_id, service_id, operator_ref, action, target_user_id,
               request_digest, result, admin_audit_head)
            values (${input.commandId}, ${input.serviceId}, ${input.operatorRef},
              'account.beta_access.update', ${input.targetUserId},
              ${input.requestDigest}, ${JSON.stringify(result)}::jsonb, ${input.adminAuditHead})`);
          return { kind: 'applied', result };
        }),
      ),
    /**
     * A command's stored result and its approval mail's state, for the admin
     * app to reconcile a response it never received. Only the service that
     * issued the command can read it back.
     */
    readOperatorCommand: (input: {
      readonly commandId: string;
      readonly serviceId: string;
    }) =>
      instrumented(eventSink, 'readOperatorCommand', async () => {
        const [row] =
          (await database.execute(sql`select r.result, m.state as mail_state
          from operator_command_receipts r
          left join mail_intents m on m.dedupe_key = 'beta-approved:' || r.command_id
          where r.command_id = ${input.commandId} and r.service_id = ${input.serviceId}`)) as unknown as {
            result: unknown;
            mail_state: string | null;
          }[];
        if (!row) return null;
        return {
          result: betaAccessCommandResultSchema.parse(row.result),
          mailState: z
            .enum(['queued', 'leased', 'sent', 'failed', 'cancelled'])
            .nullable()
            .parse(row.mail_state),
        };
      }),
  };
}
