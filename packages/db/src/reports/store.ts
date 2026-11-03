import { and, eq, isNull, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import type { ReportReason, ReportSurface } from '@daisy/protocol';
import {
  reportResolveCommandAction,
  type ReportResolveResult,
} from '@daisy/protocol/operator';
import { lockAuthorizationActors } from '../authorization';
import {
  withContactPairs,
  type ContactAuthorizationFence,
  type ContactInput,
} from '../contacts/fence';
import { instrumented, type DatabaseEventSink } from '../instrumented';
import type { RestrictionRules } from '../moderation-composition';
import {
  applySanction,
  type ModerationReactions,
  type Sanction,
} from '../moderation/store';
import {
  commandGate,
  storedResult,
  writeReceipt,
  type OperatorCommandTransaction as Transaction,
} from '../operator-command';
import { reports } from '../schema/reports';

/** Reports over the shared Contacts fence (ADR 0103). */
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

const iso = (value: Date | string) => new Date(value).toISOString();

/** How a reviewer closes a report: a length only where one means something. */
export type ReportResolution =
  | { readonly outcome: 'dismissed' | 'warned' | 'banned' }
  | { readonly outcome: 'suspended'; readonly suspendUntil: string };

/** The sanction a resolution calls for; dismissing calls for none. */
const sanctionOf = (resolution: ReportResolution): Sanction | null => {
  switch (resolution.outcome) {
    case 'dismissed':
      return null;
    case 'warned':
      return { kind: 'warning' };
    case 'banned':
      return { kind: 'ban' };
    case 'suspended':
      return { kind: 'suspension', endsAt: resolution.suspendUntil };
  }
};

export type ReportResolveInput = {
  readonly commandId: string;
  readonly reportId: string;
  readonly serviceId: string;
  readonly operatorRef: string;
  readonly resolution: ReportResolution;
  readonly requestDigest: string;
  readonly adminAuditHead: string;
  readonly now: string;
  readonly purgeAfter: string;
  readonly nextId: () => string;
  /** The engine's rules for a suspension or ban, applied in this transaction. */
  readonly restrictionRules: RestrictionRules;
  /** True while the signed request may still commit (ADR 0079, checked last). */
  readonly live: () => boolean;
};

/**
 * Closes one report under the subject's account fence: the receipt first, so
 * the same digest replays, then the report, Moderation's named write if the
 * outcome calls for one, and the receipt, all or nothing.
 */
async function resolveReport(
  tx: Transaction,
  input: ReportResolveInput,
  dependencies: {
    readonly eventSink: DatabaseEventSink | undefined;
    readonly reactions: ModerationReactions;
  },
): Promise<ReportResolveResult> {
  await commandGate(tx, input.commandId);
  const replayed = await storedResult(tx, input.commandId, input.requestDigest);
  if (replayed) return replayed as ReportResolveResult;
  const [row] =
    (await tx.execute(sql`select r.subject_actor_id as "actorId", a.user_id as "userId"
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
      outcome: input.resolution.outcome,
      operatorRef: input.operatorRef,
      purgeAfter: new Date(input.purgeAfter),
    })
    .where(and(eq(reports.id, input.reportId), isNull(reports.closedAt)))
    .returning({ id: reports.id });
  if (!closed[0]) throw createAppError('CONFLICT');
  const sanction = sanctionOf(input.resolution);
  if (sanction)
    await applySanction(
      tx,
      {
        id: input.nextId(),
        userId: row.userId,
        actorId: row.actorId,
        sanction,
        operatorRef: input.operatorRef,
        now: input.now,
        nextId: input.nextId,
      },
      dependencies,
    );
  const result: ReportResolveResult = {
    commandId: input.commandId,
    reportId: input.reportId,
    outcome: input.resolution.outcome,
  };
  await writeReceipt(tx, input, row.userId, {
    action: reportResolveCommandAction,
    result,
  });
  if (!input.live()) throw createAppError('CONFLICT');
  return result;
}

/** Reports' operations (ADR 0103), instrumented. */
export const reportOperations = ({
  database,
  eventSink,
  moderationReactions,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
  readonly moderationReactions: (
    rules: RestrictionRules,
  ) => ModerationReactions;
}) => ({
  /** The oldest of the open queue. */
  listOperatorReports: (input: {
    readonly limit: number;
  }): Promise<readonly OperatorReportRow[]> =>
    instrumented(eventSink, 'listOperatorReports', async () => {
      const rows = (await database.execute(sql`
        select r.id, ru.username as reporter, su.username as subject,
          su.id as "subjectUserId", r.reason, r.surface, r.created_at as "createdAt",
          (select count(*)::int from reports o where o.subject_actor_id = r.subject_actor_id) as "reportsOnSubject"
        from reports r
        left join actors ra on ra.id = r.reporter_actor_id
        left join users ru on ru.id = ra.user_id
        join actors sa on sa.id = r.subject_actor_id
        join users su on su.id = sa.user_id
        where r.closed_at is null
        order by r.created_at, r.id
        limit ${input.limit}`)) as unknown as (Omit<
        OperatorReportRow,
        'createdAt'
      > & { createdAt: Date | string })[];
      return rows.map((row) => ({ ...row, createdAt: iso(row.createdAt) }));
    }),
  resolveReport: (input: ReportResolveInput) =>
    instrumented(eventSink, 'resolveReport', () =>
      database.transaction((tx) =>
        resolveReport(tx, input, {
          eventSink,
          reactions: moderationReactions(input.restrictionRules),
        }),
      ),
    ),
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
