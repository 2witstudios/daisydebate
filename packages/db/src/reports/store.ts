import { and, eq, isNull, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import {
  type ModerationNotice,
  type ReportOutcome,
  type ReportReason,
  type ReportSurface,
} from '@daisy/protocol';
import {
  operatorCommandReceiptSchema,
  operatorLimits,
  reportResolveCommandAction,
  moderationLiftCommandAction,
  type ModerationLiftResult,
  type ReportResolveResult,
} from '@daisy/protocol/operator';
import {
  lockAuthorizationActors,
  readOwnCollection,
  requireOwnScope,
  type OwnCollectionFence,
} from '../authorization';
import {
  withContactPairs,
  type ContactAuthorizationFence,
  type ContactInput,
} from '../contacts/fence';
import { instrumented, type DatabaseEventSink } from '../instrumented';
import { moderationActions } from '../schema/moderation';
import { reports } from '../schema/reports';
import { appendSessionRevokedFor } from '../session-revoked';

type Transaction = Parameters<Parameters<BunSQLDatabase['transaction']>[0]>[0];

/** Reports over the shared Contacts fence (ADR 0097). */
export type ReportStore = {
  /**
   * Files one report. A second open report of the same member by the same
   * reporter changes nothing, and answers the same.
   */
  readonly file: (
    input: ContactInput,
    report: {
      readonly id: string;
      readonly subjectActorId: string;
      readonly reason: ReportReason;
      readonly surface: ReportSurface;
      readonly now: string;
    },
  ) => Promise<void>;
};

export function createReportStore({
  database,
  authorize,
}: {
  readonly database: BunSQLDatabase;
  readonly authorize: ContactAuthorizationFence;
}): ReportStore {
  return {
    file: (input, report) =>
      withContactPairs(database, authorize, input, async (tx, { refresh }) => {
        await refresh();
        await tx
          .insert(reports)
          .values({
            id: report.id,
            reporterActorId: input.actorId,
            subjectActorId: report.subjectActorId,
            reason: report.reason,
            surface: report.surface,
            createdAt: new Date(report.now),
          })
          .onConflictDoNothing();
      }),
  };
}

export type OperatorReportRow = {
  readonly id: string;
  readonly reporter: string | null;
  readonly subject: string | null;
  readonly subjectUserId: string;
  readonly reason: ReportReason;
  readonly surface: ReportSurface;
  readonly createdAt: string;
  /** Every report naming this subject, this one included. */
  readonly reportsOnSubject: number;
};

export type OperatorRestrictionRow = {
  readonly id: string;
  readonly userId: string;
  readonly username: string | null;
  readonly kind: 'suspension' | 'ban';
  readonly startsAt: string;
  readonly endsAt: string | null;
};

const iso = (value: Date | string) => new Date(value).toISOString();

const reportActions = (
  input: ReportResolveInput,
  subjectUserId: string,
  outcome: ReportOutcome,
) => {
  const base = {
    id: input.nextId(),
    userId: subjectUserId,
    startsAt: new Date(input.now),
    operatorRef: input.operatorRef,
  };
  if (outcome === 'warned') return { ...base, kind: 'warning' };
  if (outcome === 'banned') return { ...base, kind: 'ban' };
  if (outcome === 'suspended') {
    if (input.suspendUntil === null) throw createAppError('VALIDATION');
    return {
      ...base,
      kind: 'suspension',
      endsAt: new Date(input.suspendUntil),
    };
  }
  return null;
};

export type ReportResolveInput = {
  readonly commandId: string;
  readonly reportId: string;
  readonly serviceId: string;
  readonly operatorRef: string;
  readonly outcome: ReportOutcome;
  readonly suspendUntil: string | null;
  readonly requestDigest: string;
  readonly adminAuditHead: string;
  readonly now: string;
  readonly purgeAfter: string;
  readonly nextId: () => string;
  /** True while the signed request may still commit (ADR 0079, checked last). */
  readonly live: () => boolean;
};

export type ModerationLiftInput = {
  readonly commandId: string;
  readonly actionId: string;
  readonly serviceId: string;
  readonly operatorRef: string;
  readonly requestDigest: string;
  readonly adminAuditHead: string;
  readonly now: string;
  readonly live: () => boolean;
};

/** The bound, then one id at a time, as a beta access command does (ADR 0079). */
async function commandGate(tx: Transaction, commandId: string) {
  await tx.execute(
    sql.raw(`set local statement_timeout = ${operatorLimits.commandBoundMs}`),
  );
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${commandId}, 59079))`,
  );
}

async function storedResult(
  tx: Transaction,
  commandId: string,
  requestDigest: string,
) {
  const [receipt] = (await tx.execute(sql`select request_digest, result
    from operator_command_receipts where command_id = ${commandId}`)) as unknown as {
    request_digest: string;
    result: unknown;
  }[];
  if (!receipt) return null;
  if (receipt.request_digest !== requestDigest)
    throw createAppError('CONFLICT');
  return receipt.result;
}

async function writeReceipt(
  tx: Transaction,
  input: {
    readonly commandId: string;
    readonly serviceId: string;
    readonly operatorRef: string;
    readonly requestDigest: string;
    readonly adminAuditHead: string;
  },
  targetUserId: string,
  body: unknown,
) {
  const receipt = operatorCommandReceiptSchema.parse(body);
  await tx.execute(sql`insert into operator_command_receipts
      (command_id, service_id, operator_ref, action, target_user_id,
       request_digest, result, admin_audit_head)
    values (${input.commandId}, ${input.serviceId}, ${input.operatorRef},
      ${receipt.action}, ${targetUserId},
      ${input.requestDigest}, ${JSON.stringify(receipt.result)}::text::jsonb, ${input.adminAuditHead})`);
}

/**
 * Closes one report and applies its action, under the subject's account
 * fence: the receipt first, so the same digest replays, then the report, the
 * action, the account's revision (live sockets re-check it) and the receipt,
 * all or nothing. A suspension or ban also revokes their sessions.
 */
async function resolveReport(
  tx: Transaction,
  input: ReportResolveInput,
  eventSink: DatabaseEventSink | undefined,
): Promise<ReportResolveResult> {
  await commandGate(tx, input.commandId);
  const replayed = await storedResult(tx, input.commandId, input.requestDigest);
  if (replayed) return replayed as ReportResolveResult;
  const [row] = (await tx.execute(sql`select r.subject_actor_id as "actorId", a.user_id as "userId"
    from reports r join actors a on a.id = r.subject_actor_id
    where r.id = ${input.reportId}`)) as unknown as {
    actorId: string;
    userId: string;
  }[];
  if (!row) throw createAppError('NOT_FOUND');
  await lockAuthorizationActors(tx, [row.actorId], { maxActors: 1 });
  const closed = await tx
    .update(reports)
    .set({
      closedAt: new Date(input.now),
      outcome: input.outcome,
      operatorRef: input.operatorRef,
      purgeAfter: new Date(input.purgeAfter),
    })
    .where(and(eq(reports.id, input.reportId), isNull(reports.closedAt)))
    .returning({ id: reports.id });
  if (!closed[0]) throw createAppError('CONFLICT');
  const action = reportActions(input, row.userId, input.outcome);
  if (action) {
    await tx.insert(moderationActions).values(action);
    await tx.execute(
      sql`update users set version = version + 1 where id = ${row.userId}`,
    );
    if (action.kind !== 'warning')
      await appendSessionRevokedFor(tx, row.userId, eventSink, 'resolveReport');
  }
  const result: ReportResolveResult = {
    commandId: input.commandId,
    reportId: input.reportId,
    outcome: input.outcome,
  };
  await writeReceipt(tx, input, row.userId, {
    action: reportResolveCommandAction,
    result,
  });
  if (!input.live()) throw createAppError('CONFLICT');
  return result;
}

/** Lifts a suspension or ban in force; the row stays for the record. */
async function liftModeration(
  tx: Transaction,
  input: ModerationLiftInput,
): Promise<ModerationLiftResult> {
  await commandGate(tx, input.commandId);
  const replayed = await storedResult(tx, input.commandId, input.requestDigest);
  if (replayed) return replayed as ModerationLiftResult;
  const [row] = (await tx.execute(sql`select m.user_id as "userId", a.id as "actorId"
    from moderation_actions m join actors a on a.user_id = m.user_id and a.kind = 'human'
    where m.id = ${input.actionId}`)) as unknown as {
    userId: string;
    actorId: string;
  }[];
  if (!row) throw createAppError('NOT_FOUND');
  await lockAuthorizationActors(tx, [row.actorId], { maxActors: 1 });
  const lifted = await tx
    .update(moderationActions)
    .set({ liftedAt: new Date(input.now) })
    .where(
      and(
        eq(moderationActions.id, input.actionId),
        isNull(moderationActions.liftedAt),
      ),
    )
    .returning({ id: moderationActions.id });
  if (!lifted[0]) throw createAppError('CONFLICT');
  await tx.execute(
    sql`update users set version = version + 1 where id = ${row.userId}`,
  );
  const result: ModerationLiftResult = {
    commandId: input.commandId,
    actionId: input.actionId,
  };
  await writeReceipt(tx, input, row.userId, {
    action: moderationLiftCommandAction,
    result,
  });
  if (!input.live()) throw createAppError('CONFLICT');
  return result;
}

type Scope = { readonly userId: string; readonly actorId: string };

/** Reports' and moderation's operations (ADR 0097), instrumented. */
export const reportOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  /** One keyset page of the open queue, oldest first. */
  listOperatorReports: (input: {
    readonly limit: number;
    readonly after: { readonly createdAt: string; readonly id: string } | null;
  }): Promise<readonly OperatorReportRow[]> =>
    instrumented(eventSink, 'listOperatorReports', async () => {
      const after = input.after
        ? sql`and (r.created_at, r.id) > (${input.after.createdAt}::timestamptz, ${input.after.id})`
        : sql``;
      const rows = (await database.execute(sql`
        select r.id, ru.username as reporter, su.username as subject,
          su.id as "subjectUserId", r.reason, r.surface, r.created_at as "createdAt",
          (select count(*)::int from reports o where o.subject_actor_id = r.subject_actor_id) as "reportsOnSubject"
        from reports r
        join actors ra on ra.id = r.reporter_actor_id
        join users ru on ru.id = ra.user_id
        join actors sa on sa.id = r.subject_actor_id
        join users su on su.id = sa.user_id
        where r.closed_at is null ${after}
        order by r.created_at, r.id
        limit ${input.limit}`)) as unknown as (Omit<
        OperatorReportRow,
        'createdAt'
      > & { createdAt: Date | string })[];
      return rows.map((row) => ({ ...row, createdAt: iso(row.createdAt) }));
    }),
  /** Suspensions and bans in force, newest first, bounded. */
  listOperatorRestrictions: (input: {
    readonly now: string;
    readonly limit: number;
  }): Promise<readonly OperatorRestrictionRow[]> =>
    instrumented(eventSink, 'listOperatorRestrictions', async () => {
      const rows = (await database.execute(sql`
        select m.id, m.user_id as "userId", u.username, m.kind,
          m.starts_at as "startsAt", m.ends_at as "endsAt"
        from moderation_actions m join users u on u.id = m.user_id
        where m.kind in ('suspension', 'ban') and m.lifted_at is null
          and (m.ends_at is null or m.ends_at > ${new Date(input.now)})
        order by m.starts_at desc, m.id
        limit ${input.limit}`)) as unknown as (Omit<
        OperatorRestrictionRow,
        'startsAt' | 'endsAt'
      > & { startsAt: Date | string; endsAt: Date | string | null })[];
      return rows.map((row) => ({
        ...row,
        startsAt: iso(row.startsAt),
        endsAt: row.endsAt === null ? null : iso(row.endsAt),
      }));
    }),
  resolveReport: (input: ReportResolveInput) =>
    instrumented(eventSink, 'resolveReport', () =>
      database.transaction((tx) => resolveReport(tx, input, eventSink)),
    ),
  liftModeration: (input: ModerationLiftInput) =>
    instrumented(eventSink, 'liftModeration', () =>
      database.transaction((tx) => liftModeration(tx, input)),
    ),
  /** The member's own warnings they have not acknowledged. */
  listModerationNotices: (
    scope: Scope,
    authorize: OwnCollectionFence<Scope>,
  ): Promise<readonly ModerationNotice[]> => {
    requireOwnScope(scope);
    return instrumented(eventSink, 'listModerationNotices', () =>
      readOwnCollection(database, scope, authorize, async (tx) => {
        const rows = (await tx.execute(sql`
          select id, kind, starts_at as "startsAt" from moderation_actions
          where user_id = ${scope.userId} and kind = 'warning' and acknowledged_at is null
          order by starts_at desc limit 5`)) as unknown as {
          id: string;
          kind: ModerationNotice['kind'];
          startsAt: Date | string;
        }[];
        return rows.map((row) => ({ ...row, startsAt: iso(row.startsAt) }));
      }),
    );
  },
  /** Marks one of the member's own warnings read; another's changes nothing. */
  acknowledgeModerationNotice: (
    scope: Scope,
    input: { readonly id: string; readonly now: string },
    authorize: OwnCollectionFence<Scope>,
  ): Promise<void> => {
    requireOwnScope(scope);
    return instrumented(eventSink, 'acknowledgeModerationNotice', () =>
      readOwnCollection(database, scope, authorize, async (tx) => {
        await tx.execute(sql`update moderation_actions
          set acknowledged_at = ${new Date(input.now)}
          where id = ${input.id} and user_id = ${scope.userId} and acknowledged_at is null`);
      }),
    );
  },
  /** Closed reports past their evidence retention (DEC-298, COMP-4). */
  purgeClosedReports: (input: {
    readonly now: string;
    readonly limit: number;
  }): Promise<number> =>
    instrumented(eventSink, 'purgeClosedReports', async () => {
      const rows = await database.execute(sql`
        delete from reports where id in (
          select id from reports
          where purge_after is not null and purge_after <= ${new Date(input.now)}
          limit ${input.limit})
        returning id`);
      return rows.length;
    }),
});
