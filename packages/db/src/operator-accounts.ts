import { createAppError } from '@daisy/errors';
import {
  betaAccessStates,
  idSchema,
  type BetaAccessState,
} from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { z } from 'zod';
import { operatorCommandStateSchema } from '@daisy/protocol/operator';
import {
  runBetaAccessCommand,
  type BetaAccessCommandInput,
  type BetaAccessCommandOutcome,
} from './beta-access-command';
import { instrumented, type DatabaseEventSink } from './instrumented';

type Database = Pick<BunSQLDatabase, 'transaction' | 'execute'>;

const instant = z
  .union([z.date(), z.string()])
  .transform((value) => new Date(value).toISOString());
const accountRow = z.object({
  user_id: idSchema,
  username: z.string().nullable(),
  state: z.enum(betaAccessStates),
  revision: z.coerce.number().int().positive(),
  // The keyset position: kept to the microsecond, as stored, so a cursor
  // built from it never skips a row requested in the same millisecond.
  requested_at: z.iso.datetime({ precision: 6 }),
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
            b.revision, to_char(b.requested_at at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as requested_at, b.decided_at
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
        database.transaction((tx) =>
          runBetaAccessCommand(tx, input, eventSink),
        ),
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
        return operatorCommandStateSchema.parse({
          result: row.result,
          mailState: row.mail_state,
        });
      }),
  };
}
