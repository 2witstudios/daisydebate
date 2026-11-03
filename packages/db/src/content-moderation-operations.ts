import { createAppError } from '@daisy/errors';
import type {
  ContentModerationCommandResult,
  ContentReport,
  ContentReportDetail,
  ContentModerationSubject,
} from '@daisy/protocol/content-moderation';
import {
  contentModerationCommandResultSchema,
  contentReportSchema,
  queueOfReason,
  type recordingLegalRemovalReasons,
  type recordingTakedownReasons,
  type ContentModerationAction,
  type ContentModerationQueue,
} from '@daisy/protocol/content-moderation';
import {
  operatorCommandReceiptSchema,
  operatorLimits,
} from '@daisy/protocol/operator';
import type { ContentReportCreate } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { z } from 'zod';
import { endBroadcastFeed, stopBroadcast } from './broadcast-operations';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { inLiveRoomSql, liveRoomOfR } from './live-room-sql';
import {
  noRecordings,
  noSpectatorChat,
  type ContentModerationOutcome,
  type RecordingModeration,
  type SpectatorChatModeration,
} from './content-moderation-ports';
import type { BoundedTransactionContext } from './transaction-context';

type Database = Pick<BunSQLDatabase, 'transaction' | 'execute'> &
  BoundedTransactionContext;
type Tx = BoundedTransactionContext;

const rows = async <T>(
  tx: Pick<Tx, 'execute'>,
  query: ReturnType<typeof sql>,
) => (await tx.execute(query)) as unknown as T[];

const roundFacts = async (tx: Tx, roundId: string, actorId: string) => {
  const [round] = await rows<{
    visibility: 'public' | 'unlisted' | 'private';
    competition_type: string;
    audience_link_hash: string | null;
    seated: boolean;
    in_live_room: boolean;
  }>(
    tx,
    sql`select r.visibility, r.competition_type, r.audience_link_hash,
        exists(select 1 from round_participants p
          where p.round_id = r.id and p.actor_id = ${actorId}) as seated,
        ${inLiveRoomSql(liveRoomOfR, actorId)} as in_live_room
      from rounds r where r.id = ${roundId}`,
  );
  if (!round) return { kind: 'missing' } as const;
  return {
    kind: 'footage',
    ranked: round.competition_type === 'ranked',
    reporterSeated: round.seated,
    audience: {
      roundId,
      visibility: round.visibility,
      audienceLinkHash: round.audience_link_hash,
      inLiveRoom: round.in_live_room,
    },
  } as const;
};

/** The side this reporter debated on, when the ballot has feedback for it. */
const feedbackSideFor = async (tx: Tx, ballotId: string, actorId: string) => {
  const [row] = await rows<{ side: string }>(
    tx,
    sql`select p.role as side from ballots b
      join round_participants p on p.round_id = b.round_id
      where b.id = ${ballotId}
        and p.actor_id = ${actorId}
        and p.role in ('affirmative', 'negative')
        and b.feedback ? p.role
      limit 1`,
  );
  return row?.side ?? null;
};

const instant = z
  .union([z.date(), z.string()])
  .transform((value) => new Date(value).toISOString());
const reportRow = z.object({
  id: z.string(),
  target_kind: z.string(),
  target_id: z.string(),
  reason: z.string(),
  status: z.string(),
  // The keyset position, kept to the microsecond as stored.
  created_at: z.iso.datetime({ precision: 6 }),
  resolved_at: instant.nullable(),
});
const reportOf = (raw: unknown): ContentReport => {
  const row = reportRow.parse(raw);
  return contentReportSchema.parse({
    reportId: row.id,
    targetKind: row.target_kind,
    targetId: row.target_id,
    reason: row.reason,
    status: row.status,
    reportedAt: row.created_at,
    resolvedAt: row.resolved_at,
  });
};
const reportColumns = sql`id, target_kind, target_id, reason, status, resolved_at,
  to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at`;

export type ContentModerationChange =
  | {
      readonly action: 'content_report.resolve';
      readonly reportId: string;
      readonly outcome: 'upheld' | 'dismissed';
    }
  | {
      readonly action: 'broadcast.stop';
      readonly broadcastId: string;
      readonly reason: string;
    }
  | {
      readonly action: 'broadcast.chat_slow_mode.update';
      readonly broadcastId: string;
      readonly seconds: number;
    }
  | {
      readonly action: 'recording.takedown';
      readonly recordingId: string;
      readonly expectedVersion: number;
      readonly reason: (typeof recordingTakedownReasons)[number];
    }
  | {
      readonly action: 'recording.legal_remove';
      readonly recordingId: string;
      readonly expectedVersion: number;
      readonly reason: (typeof recordingLegalRemovalReasons)[number];
    }
  | {
      readonly action:
        'recording.restore' | 'recording.remove' | 'recording.rebuild';
      readonly recordingId: string;
      readonly expectedVersion: number;
    }
  | { readonly action: 'chat_message.remove'; readonly messageId: string }
  | {
      readonly action: 'account.audience_ban.update';
      readonly userId: string;
      readonly state: 'banned' | 'lifted';
    };

type Ports = {
  readonly recordings: RecordingModeration;
  readonly chat: SpectatorChatModeration;
};

const dbNow = async (tx: Tx) => {
  const [row] = await rows<{ now: Date | string }>(
    tx,
    sql`select now() as now`,
  );
  return new Date(row!.now);
};

const changed = (count: number, exists: boolean): ContentModerationOutcome =>
  count > 0 ? 'applied' : exists ? 'unchanged' : null;

const resolveReport = async (
  tx: Tx,
  change: Extract<
    ContentModerationChange,
    { action: 'content_report.resolve' }
  >,
  operatorRef: string,
  now: Date,
) => {
  const updated = await rows(
    tx,
    sql`update content_reports set status = ${change.outcome},
        resolved_at = ${now.toISOString()}::timestamptz, resolved_by_ref = ${operatorRef}
      where id = ${change.reportId} and status = 'open' returning id`,
  );
  const found = await rows(
    tx,
    sql`select id from content_reports where id = ${change.reportId}`,
  );
  return changed(updated.length, found.length > 0);
};

const setSlowMode = async (
  tx: Tx,
  change: Extract<
    ContentModerationChange,
    { action: 'broadcast.chat_slow_mode.update' }
  >,
) => {
  const updated = await rows(
    tx,
    sql`update broadcasts set chat_slow_mode_seconds = ${change.seconds}
      where id = ${change.broadcastId} and chat_slow_mode_seconds <> ${change.seconds}
      returning id`,
  );
  const found = await rows(
    tx,
    sql`select id from broadcasts where id = ${change.broadcastId}`,
  );
  return changed(updated.length, found.length > 0);
};

const setAudienceBan = async (
  tx: Tx,
  change: Extract<
    ContentModerationChange,
    { action: 'account.audience_ban.update' }
  >,
  operatorRef: string,
) => {
  const [live] = await rows(
    tx,
    sql`select id from users where id = ${change.userId} and deleted_at is null`,
  );
  if (!live) return null;
  const written =
    change.state === 'banned'
      ? await rows(
          tx,
          sql`insert into audience_bans (user_id, banned_by_ref)
            values (${change.userId}, ${operatorRef})
            on conflict do nothing returning user_id`,
        )
      : await rows(
          tx,
          sql`delete from audience_bans where user_id = ${change.userId} returning user_id`,
        );
  return changed(written.length, true);
};

/**
 * Taking a Recording down or removing it also ends the Round's feed, in the same
 * transaction: what is hidden must not keep playing to whoever is watching live. A
 * restore does not start it again, and the video comes back with the Recording,
 * since only an operator's stop holds it back. The feed stops once, whichever
 * command got there first.
 */
const endingFeed = async (
  tx: Tx,
  input: {
    readonly recordingId: string;
    readonly reason: string;
    readonly now: Date;
    readonly ports: Ports;
  },
  moved: ContentModerationOutcome,
): Promise<ContentModerationOutcome> => {
  if (moved === null) return null;
  const broadcastId = await input.ports.recordings.readBroadcastId(
    tx,
    input.recordingId,
  );
  const feed = broadcastId
    ? await endBroadcastFeed(tx, {
        id: broadcastId,
        reason: input.reason,
        now: input.now,
      })
    : null;
  return feed === 'applied' ? 'applied' : moved;
};

const applyChange = (
  tx: Tx,
  change: ContentModerationChange,
  operatorRef: string,
  now: Date,
  ports: Ports,
): Promise<ContentModerationOutcome> => {
  switch (change.action) {
    case 'content_report.resolve':
      return resolveReport(tx, change, operatorRef, now);
    case 'broadcast.stop':
      return stopBroadcast(tx, {
        id: change.broadcastId,
        reason: change.reason,
        now,
      });
    case 'broadcast.chat_slow_mode.update':
      return setSlowMode(tx, change);
    case 'recording.takedown':
      return ports.recordings
        .takeDown(tx, {
          recordingId: change.recordingId,
          expectedVersion: change.expectedVersion,
          reason: change.reason,
          now,
        })
        .then((moved) =>
          endingFeed(
            tx,
            {
              recordingId: change.recordingId,
              reason: change.reason,
              now,
              ports,
            },
            moved,
          ),
        );
    case 'recording.restore':
      return ports.recordings.restore(tx, change);
    case 'recording.remove':
      return ports.recordings.remove(tx, { ...change, now }).then((moved) =>
        endingFeed(
          tx,
          {
            recordingId: change.recordingId,
            reason: 'recording_removed',
            now,
            ports,
          },
          moved,
        ),
      );
    case 'recording.legal_remove':
      return ports.recordings
        .legallyRemove(tx, { ...change, now })
        .then((moved) =>
          endingFeed(
            tx,
            {
              recordingId: change.recordingId,
              reason: 'recording_legally_removed',
              now,
              ports,
            },
            moved,
          ),
        );
    case 'recording.rebuild':
      return ports.recordings.rebuild(tx, change);
    case 'chat_message.remove':
      return ports.chat.remove(tx, { messageId: change.messageId, now });
    case 'account.audience_ban.update':
      return setAudienceBan(tx, change, operatorRef);
  }
};

const subjectOf = async (
  tx: Tx,
  report: ContentReport,
  feedbackSide: string | null,
  ports: Ports,
): Promise<ContentModerationSubject | null> => {
  switch (report.targetKind) {
    case 'round': {
      const [round] = await rows<{
        resolution: string;
        competition_type: 'ranked' | 'casual';
        broadcast_id: string | null;
        stopped_at: unknown;
        chat_slow_mode_seconds: number | null;
      }>(
        tx,
        sql`select r.resolution, r.competition_type, b.id as broadcast_id,
            b.stopped_at, b.chat_slow_mode_seconds
          from rounds r left join broadcasts b on b.round_id = r.id
          where r.id = ${report.targetId}`,
      );
      return round
        ? {
            kind: 'round',
            roundId: report.targetId,
            resolution: round.resolution,
            competitionType: round.competition_type,
            broadcastId: round.broadcast_id,
            broadcastStopped: round.stopped_at !== null,
            chatSlowModeSeconds: round.chat_slow_mode_seconds ?? 0,
          }
        : null;
    }
    case 'recording': {
      const recording = await ports.recordings.readSubject(tx, report.targetId);
      return (
        recording && {
          kind: 'recording',
          recordingId: report.targetId,
          ...recording,
        }
      );
    }
    case 'chat_message': {
      const message = await ports.chat.readSubject(tx, report.targetId);
      return (
        message && {
          kind: 'chat_message',
          messageId: report.targetId,
          ...message,
        }
      );
    }
    case 'ballot_feedback': {
      // Only the side reported, and only because it was reported.
      const [ballot] = await rows<{ text: string | null }>(
        tx,
        sql`select feedback ->> ${feedbackSide} as text from ballots where id = ${report.targetId}`,
      );
      return ballot
        ? {
            kind: 'ballot_feedback',
            ballotId: report.targetId,
            side: feedbackSide as 'affirmative' | 'negative',
            text: ballot.text,
          }
        : null;
    }
  }
};

/**
 * Reports and operator moderation (WATCH-7). A command runs as ADR 0079's
 * beta command does: one transaction, every statement bounded, the receipt
 * first, the commit deadline last, and a refusal writes nothing.
 */
export function contentModerationOperations({
  database,
  eventSink,
  recordings = noRecordings,
  chat = noSpectatorChat,
}: {
  readonly database: Database;
  readonly eventSink?: DatabaseEventSink | undefined;
  readonly recordings?: RecordingModeration;
  readonly chat?: SpectatorChatModeration;
}) {
  const ports = { recordings, chat };
  return {
    readReportTargetFacts: (input: {
      readonly reporterUserId: string;
      readonly reporterActorId: string;
      readonly report: ContentReportCreate;
    }) =>
      instrumented(eventSink, 'readReportTargetFacts', async () => {
        const { report, reporterActorId: actorId } = input;
        switch (report.targetKind) {
          case 'round':
            return roundFacts(database, report.targetId, actorId);
          case 'recording': {
            const facts = await recordings.readReportFacts(database, {
              recordingId: report.targetId,
              reporterActorId: actorId,
            });
            return facts
              ? ({ kind: 'footage', ...facts } as const)
              : ({ kind: 'missing' } as const);
          }
          case 'chat_message': {
            const facts = await chat.readReportFacts(database, {
              messageId: report.targetId,
              reporterActorId: actorId,
            });
            return facts
              ? ({ kind: 'chat_message', ...facts } as const)
              : ({ kind: 'missing' } as const);
          }
          case 'ballot_feedback':
            return {
              kind: 'ballot_feedback',
              feedbackIsForReporter:
                (await feedbackSideFor(database, report.targetId, actorId)) !==
                null,
            } as const;
        }
      }),
    /** One report per reporter and target: a repeat keeps the first. */
    fileReport: (input: {
      readonly id: string;
      readonly reporterUserId: string;
      readonly reporterActorId: string;
      readonly report: ContentReportCreate;
    }) =>
      instrumented(eventSink, 'fileReport', async () => {
        const { report } = input;
        const side =
          report.targetKind === 'ballot_feedback'
            ? await feedbackSideFor(
                database,
                report.targetId,
                input.reporterActorId,
              )
            : null;
        await database.execute(sql`insert into content_reports
            (id, reporter_user_id, target_kind, target_id, feedback_side, reason, queue)
          values (${input.id}, ${input.reporterUserId}, ${report.targetKind},
            ${report.targetId}, ${side}, ${report.reason}, ${queueOfReason(report.reason)})
          on conflict do nothing`);
      }),
    /** One keyset page, newest report first, id breaking ties. */
    listModerationReports: (input: {
      readonly queue: ContentModerationQueue;
      readonly status: ContentReport['status'];
      readonly limit: number;
      readonly after: {
        readonly reportedAt: string;
        readonly reportId: string;
      } | null;
    }) =>
      instrumented(eventSink, 'listModerationReports', async () => {
        const after = input.after
          ? sql`and (created_at, id) < (${input.after.reportedAt}::timestamptz, ${input.after.reportId})`
          : sql``;
        const found = await rows<unknown>(
          database,
          sql`select ${reportColumns} from content_reports
            where queue = ${input.queue} and status = ${input.status} ${after}
            order by created_at desc, id desc limit ${input.limit}`,
        );
        return found.map(reportOf);
      }),
    readModerationReport: (reportId: string) =>
      instrumented(
        eventSink,
        'readModerationReport',
        async (): Promise<ContentReportDetail | null> => {
          const [row] = await rows<{ feedback_side: string | null }>(
            database,
            sql`select ${reportColumns}, feedback_side from content_reports where id = ${reportId}`,
          );
          if (!row) return null;
          const { feedback_side: side, ...fields } = row;
          const report = reportOf(fields);
          return {
            report,
            subject: await subjectOf(database, report, side, ports),
          };
        },
      ),
    runModerationCommand: (input: {
      readonly commandId: string;
      readonly serviceId: string;
      readonly operatorRef: string;
      readonly requestDigest: string;
      readonly adminAuditHead: string;
      readonly live: () => boolean;
      readonly change: ContentModerationChange;
    }): Promise<ContentModerationCommandResult> =>
      instrumented(eventSink, 'runModerationCommand', () =>
        database.transaction(async (tx) => {
          await tx.execute(
            sql.raw(
              `set local statement_timeout = ${operatorLimits.commandBoundMs}`,
            ),
          );
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${input.commandId}, 59079))`,
          );
          const [stored] = await rows<{
            request_digest: string;
            result: unknown;
          }>(
            tx,
            sql`select request_digest, result from operator_command_receipts
              where command_id = ${input.commandId}`,
          );
          if (stored) {
            if (stored.request_digest !== input.requestDigest)
              throw createAppError('CONFLICT');
            return contentModerationCommandResultSchema.parse(stored.result);
          }
          const outcome = await applyChange(
            tx,
            input.change,
            input.operatorRef,
            await dbNow(tx),
            ports,
          );
          if (outcome === null) throw createAppError('NOT_FOUND');
          const action: ContentModerationAction = input.change.action;
          const receipt = operatorCommandReceiptSchema.parse({
            action,
            result: { v: 1, outcome },
          });
          const targetUserId =
            input.change.action === 'account.audience_ban.update'
              ? input.change.userId
              : null;
          await tx.execute(sql`insert into operator_command_receipts
              (command_id, service_id, operator_ref, action, target_user_id,
               request_digest, result, admin_audit_head)
            values (${input.commandId}, ${input.serviceId}, ${input.operatorRef},
              ${receipt.action}, ${targetUserId}, ${input.requestDigest},
              ${JSON.stringify(receipt.result)}::text::jsonb, ${input.adminAuditHead})`);
          // Checked last: a command delayed past its deadline writes nothing.
          if (!input.live()) throw createAppError('CONFLICT');
          return contentModerationCommandResultSchema.parse(receipt.result);
        }),
      ),
    listRebuildableRecordings: () =>
      instrumented(eventSink, 'listRebuildableRecordings', () =>
        recordings.listRebuildable(database, 100),
      ),
    /** What `decideChatPost` needs that this store holds. */
    readChatPostFacts: (input: {
      readonly userId: string;
      readonly broadcastId: string;
    }) =>
      instrumented(eventSink, 'readChatPostFacts', async () => {
        const [row] = await rows<{
          banned: boolean;
          seconds: number | null;
        }>(
          database,
          sql`select exists(select 1 from audience_bans where user_id = ${input.userId}) as banned,
            (select chat_slow_mode_seconds from broadcasts where id = ${input.broadcastId}) as seconds`,
        );
        return {
          banned: row?.banned ?? false,
          slowModeSeconds: row?.seconds ?? 0,
        };
      }),
  };
}
