import { listedWord } from './lifecycle-sql';
import { insertContentReport } from './content-report-write';
import { publicProfileModeration } from './public-profile-moderation';
import { createAppError } from '@daisy/errors';
import type {
  ContentModerationCommandResult,
  ContentReport,
  ContentReportDetail,
  ContentModerationSubject,
  ProfileContentRemovalReason,
} from '@daisy/protocol/content-moderation';
import {
  PROFILE_PHOTO_REVIEWS_MAX,
  contentModerationCommandResultSchema,
  contentReportSchema,
  contentReportStatuses,
  type ContentModerationAction,
  type ContentModerationQueue,
  type broadcastStopReasons,
  type recordingLegalRemovalReasons,
  type recordingTakedownReasons,
} from '@daisy/protocol/content-moderation';
import { operatorCommandReceiptSchema } from '@daisy/protocol/operator';
import { feedbackSubjectOf } from '@daisy/protocol/ballot-schema';
import { roundJudgingSchema } from '@daisy/protocol/ballot-definition';
import { type BroadcastFeedEndReason } from '@daisy/protocol/broadcast';
import { type ContentReportCreate } from '@daisy/protocol/content-moderation';
import { seatOfColumns } from './seat-columns';
import { sql } from 'drizzle-orm';
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
  type ChatMessageModeration,
} from './content-moderation-ports';
import { inTransaction, type TxSource, type Tx } from './tx';
import { commandGate, storedResult, writeReceipt } from './operator-command';
import { query as queryRows } from './raw-rows';

const roundFacts = async (tx: Tx, roundId: string, actorId: string) => {
  const [round] = await queryRows(
    tx,
    z.object({
      visibility: z.enum(['public', 'unlisted', 'private']).nullable(),
      competition_type: z.string(),
      audience_link_hash: z.string().nullable(),
      seated: z.boolean(),
      in_live_room: z.boolean(),
    }),
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

/** A ballot feedback report names its subject (`content_reports_feedback_subject_check`). */
const requireFeedbackSubject = (subject: string | null): string => {
  if (subject === null)
    throw createAppError('INVARIANT', 'A feedback report names its subject');
  return subject;
};

/**
 * The subject this reporter's feedback is written under (their side, or
 * their own participant id when the ballot ranks speakers, per the Round's
 * frozen definition), when the ballot has feedback for it.
 */
const feedbackSubjectFor = async (
  tx: Tx,
  ballotId: string,
  actorId: string,
): Promise<string | null> => {
  const [row] = await queryRows(
    tx,
    z.object({
      id: z.string(),
      seat_kind: z.enum(['side', 'speaker', 'judge', 'moderator']),
      side: z.string().nullable(),
      slot: z.number(),
      judging: z.string().nullable(),
      feedback: z.string().nullable(),
    }),
    sql`select p.id, p.seat_kind, p.side, p.slot, r.judging::text as judging,
        b.feedback::text as feedback
      from ballots b
      join rounds r on r.id = b.round_id
      join round_participants p on p.round_id = b.round_id
      where b.id = ${ballotId} and p.actor_id = ${actorId}
      limit 1`,
  );
  if (!row) return null;
  const judging = roundJudgingSchema.parse(
    row.judging === null ? null : JSON.parse(row.judging),
  );
  const subject = feedbackSubjectOf(judging?.ballot ?? null, {
    id: row.id,
    seat: seatOfColumns({
      seatKind: row.seat_kind,
      side: row.side,
      slot: row.slot,
    }),
  });
  const feedback = z
    .record(z.string(), z.unknown())
    .parse(row.feedback === null ? {} : JSON.parse(row.feedback));
  return subject !== null && subject in feedback ? subject : null;
};

const instant = z
  .union([z.date(), z.string()])
  .transform((value) => new Date(value).toISOString());
const reportRow = z.object({
  id: z.string(),
  target_kind: z.string(),
  target_id: z.string(),
  reason: z.string(),
  status: z.enum(contentReportStatuses),
  // The keyset position, kept to the microsecond as stored.
  created_at: z.iso.datetime({ precision: 6 }),
  resolved_at: instant.nullable(),
});
const reportOf = (row: z.output<typeof reportRow>): ContentReport => {
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
      readonly reason: (typeof broadcastStopReasons)[number];
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
      readonly action: 'recording.remove';
      readonly recordingId: string;
      readonly expectedVersion: number;
    }
  | {
      readonly action: 'recording.restore' | 'recording.rebuild';
      readonly recordingId: string;
      readonly expectedVersion: number;
    }
  | { readonly action: 'chat_message.remove'; readonly messageId: string }
  | {
      readonly action: 'profile_photo.review';
      readonly photoId: string;
      readonly expectedVersion: number;
      readonly outcome: 'approve' | 'reject';
    }
  | {
      readonly action: 'profile_photo.remove';
      readonly photoId: string;
      readonly expectedVersion: number;
      readonly reason: ProfileContentRemovalReason;
    }
  | {
      readonly action: 'profile_text.remove';
      readonly profileId: string;
      readonly expectedVersion: number;
      readonly field: 'display_name' | 'bio';
      readonly reason: ProfileContentRemovalReason;
    }
  | {
      readonly action: 'account.audience_ban.update';
      readonly userId: string;
      readonly state: 'banned' | 'lifted';
    };

type Ports = {
  readonly recordings: RecordingModeration;
  readonly chat: SpectatorChatModeration;
  readonly floor: ChatMessageModeration;
  readonly roomChat: ChatMessageModeration;
};

const dbNow = async (tx: Tx) => {
  const [row] = await queryRows(
    tx,
    z.object({ now: z.union([z.string(), z.date()]) }),
    sql`select now() as now`,
  );
  if (!row) throw createAppError('INVARIANT');
  return new Date(row.now);
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
  const updated = await queryRows(
    tx,
    z.object({ id: z.string() }),
    sql`update content_reports set status = ${change.outcome},
        resolved_at = ${now.toISOString()}::timestamptz, resolved_by_ref = ${operatorRef}
      where id = ${change.reportId} and status = ${listedWord(contentReportStatuses, 'open')} returning id`,
  );
  const found = await queryRows(
    tx,
    z.object({ id: z.string() }),
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
  const updated = await queryRows(
    tx,
    z.object({ id: z.string() }),
    sql`update broadcasts set chat_slow_mode_seconds = ${change.seconds}
      where id = ${change.broadcastId} and chat_slow_mode_seconds <> ${change.seconds}
      returning id`,
  );
  const found = await queryRows(
    tx,
    z.object({ id: z.string() }),
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
  const [live] = await queryRows(
    tx,
    z.object({ id: z.string() }),
    sql`select id from users where id = ${change.userId} and deleted_at is null`,
  );
  if (!live) return null;
  const written =
    change.state === 'banned'
      ? await queryRows(
          tx,
          z.object({ user_id: z.string() }),
          sql`insert into audience_bans (user_id, banned_by_ref)
            values (${change.userId}, ${operatorRef})
            on conflict do nothing returning user_id`,
        )
      : await queryRows(
          tx,
          z.object({ user_id: z.string() }),
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
const endRecordingFeed = async (
  tx: Tx,
  input: {
    readonly recordingId: string;
    readonly reason: BroadcastFeedEndReason;
    readonly now: Date;
    readonly ports: Ports;
  },
): Promise<ContentModerationOutcome> => {
  const broadcastId = await input.ports.recordings.readBroadcastId(
    tx,
    input.recordingId,
  );
  return broadcastId
    ? await endBroadcastFeed(tx, {
        id: broadcastId,
        reason: input.reason,
        now: input.now,
      })
    : null;
};

const applyChange = (
  tx: Tx,
  change: Exclude<
    ContentModerationChange,
    {
      action:
        | 'recording.takedown'
        | 'recording.remove'
        | 'recording.legal_remove'
        | 'chat_message.remove';
    }
  >,
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
    case 'recording.restore':
      return ports.recordings.restore(tx, change);
    case 'recording.rebuild':
      return ports.recordings.rebuild(tx, change);
    case 'profile_photo.review':
      return publicProfileModeration.reviewPhoto(tx, { ...change, now });
    case 'profile_photo.remove':
      return publicProfileModeration.removePhoto(tx, { ...change, now });
    case 'profile_text.remove':
      return publicProfileModeration.removeText(tx, { ...change, now });
    case 'account.audience_ban.update':
      return setAudienceBan(tx, change, operatorRef);
  }
};

const subjectOf = async (
  tx: Tx,
  report: ContentReport,
  feedbackSubject: string | null,
  ports: Ports,
): Promise<ContentModerationSubject | null> => {
  switch (report.targetKind) {
    case 'round': {
      const [round] = await queryRows(
        tx,
        z.object({
          resolution: z.string(),
          competition_type: z.enum(['ranked', 'casual']),
          broadcast_id: z.string().nullable(),
          stopped_at: z.unknown(),
          chat_slow_mode_seconds: z.number().nullable(),
        }),
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
      const message =
        (await ports.chat.readSubject(tx, report.targetId)) ??
        (await ports.floor.readSubject(tx, report.targetId)) ??
        (await ports.roomChat.readSubject(tx, report.targetId));
      return (
        message && {
          kind: 'chat_message',
          messageId: report.targetId,
          ...message,
        }
      );
    }
    case 'ballot_feedback': {
      // Only the subject reported, and only because it was reported.
      const [ballot] = await queryRows(
        tx,
        z.object({ text: z.string().nullable() }),
        sql`select feedback ->> ${feedbackSubject} as text from ballots where id = ${report.targetId}`,
      );
      return ballot
        ? {
            kind: 'ballot_feedback',
            ballotId: report.targetId,
            subject: requireFeedbackSubject(feedbackSubject),
            text: ballot.text,
          }
        : null;
    }
    case 'profile_photo':
      return publicProfileModeration.readPhotoSubject(tx, report.targetId);
    case 'profile_display_name':
      return publicProfileModeration.readTextSubject(
        tx,
        report.targetId,
        'display_name',
      );
    case 'profile_bio':
      return publicProfileModeration.readTextSubject(
        tx,
        report.targetId,
        'bio',
      );
  }
};

/**
 * Reports and operator moderation (WATCH-7). A command runs as ADR 0079's
 * beta command does: one transaction, every statement bounded, the receipt
 * first, the commit deadline last, and a refusal writes nothing.
 */
type ModerationCommandInput = {
  readonly commandId: string;
  readonly serviceId: string;
  readonly operatorRef: string;
  readonly requestDigest: string;
  readonly adminAuditHead: string;
  readonly live: () => boolean;
  readonly change: ContentModerationChange;
};
type WithdrawalInput = Omit<ModerationCommandInput, 'change'> & {
  readonly change: Extract<
    ContentModerationChange,
    {
      action:
        'recording.takedown' | 'recording.remove' | 'recording.legal_remove';
    }
  >;
};
type WithdrawalLoad =
  | {
      readonly kind: 'replayed';
      readonly result: ContentModerationCommandResult;
    }
  | {
      readonly kind: 'fresh';
      readonly recording: ContentModerationOutcome;
      readonly endFeed: (
        reason: BroadcastFeedEndReason,
      ) => Promise<ContentModerationOutcome>;
      readonly settle: (
        result: ContentModerationCommandResult,
      ) => Promise<void>;
    };
type WithdrawalLifecycle =
  | {
      readonly kind:
        | 'new'
        | 'loading'
        | 'prepared'
        | 'ending'
        | 'ended'
        | 'settling'
        | 'closed';
    }
  | {
      readonly kind: 'settled' | 'replayed';
      readonly result: ContentModerationCommandResult;
    };

type ChatRemovalPorts = {
  readonly spectator: () => Promise<ContentModerationOutcome>;
  readonly floor: () => Promise<ContentModerationOutcome>;
  readonly room: () => Promise<ContentModerationOutcome>;
};
type ChatRemovalPhase = 'ready' | 'removing' | 'found' | 'closed';

export function contentModerationOperations({
  database,
  eventSink,
  recordings = noRecordings,
  chat = noSpectatorChat,
  floor = noSpectatorChat,
  roomChat = noSpectatorChat,
}: {
  readonly database: TxSource;
  readonly eventSink?: DatabaseEventSink | undefined;
  readonly recordings?: RecordingModeration;
  readonly chat?: SpectatorChatModeration;
  readonly floor?: ChatMessageModeration;
  readonly roomChat?: ChatMessageModeration;
}) {
  const ports = { recordings, chat, floor, roomChat };
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
                (await feedbackSubjectFor(
                  database,
                  report.targetId,
                  actorId,
                )) !== null,
            } as const;
          case 'profile_photo':
            return publicProfileModeration.readPhotoReportFacts(database, {
              photoId: report.targetId,
              reporterActorId: actorId,
            });
          case 'profile_display_name':
          case 'profile_bio':
            return publicProfileModeration.readTextReportFacts(database, {
              profileId: report.targetId,
              field:
                report.targetKind === 'profile_bio' ? 'bio' : 'display_name',
              reporterActorId: actorId,
            });
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
        const subject =
          report.targetKind === 'ballot_feedback'
            ? await feedbackSubjectFor(
                database,
                report.targetId,
                input.reporterActorId,
              )
            : null;
        await insertContentReport(database, {
          id: input.id,
          reporterUserId: input.reporterUserId,
          report,
          feedbackSubject: subject,
        });
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
        const found = await queryRows(
          database,
          reportRow,
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
          const [row] = await queryRows(
            database,
            reportRow.extend({ feedback_subject: z.string().nullable() }),
            sql`select ${reportColumns}, feedback_subject from content_reports where id = ${reportId}`,
          );
          if (!row) return null;
          const { feedback_subject: feedbackSubject, ...fields } = row;
          const report = reportOf(fields);
          return {
            report,
            subject: await subjectOf(database, report, feedbackSubject, ports),
          };
        },
      ),
    /** Preparing Recording effects remain provisional until feed orchestration and receipt settle. */
    recordingWithdrawalCommand: (
      input: WithdrawalInput,
      work: (session: {
        readonly load: () => Promise<WithdrawalLoad>;
      }) => Promise<void>,
    ): Promise<ContentModerationCommandResult> =>
      instrumented(eventSink, 'runModerationCommand', () =>
        inTransaction(database, async (tx) => {
          const lifecycle: { current: WithdrawalLifecycle } = {
            current: { kind: 'new' },
          };
          const phase = () => lifecycle.current.kind;
          const load = async (): Promise<WithdrawalLoad> => {
            if (phase() !== 'new') throw createAppError('INVARIANT');
            lifecycle.current = { kind: 'loading' };
            await commandGate(tx, input.commandId);
            const stored = await storedResult(
              tx,
              input.commandId,
              input.requestDigest,
            );
            if (phase() !== 'loading') throw createAppError('INVARIANT');
            if (stored) {
              const result = contentModerationCommandResultSchema.parse(stored);
              lifecycle.current = { kind: 'replayed', result };
              return { kind: 'replayed', result };
            }
            const now = await dbNow(tx);
            const change = input.change;
            const recording =
              change.action === 'recording.takedown'
                ? await ports.recordings.takeDown(tx, { ...change, now })
                : change.action === 'recording.remove'
                  ? await ports.recordings.remove(tx, { ...change, now })
                  : await ports.recordings.legallyRemove(tx, {
                      ...change,
                      now,
                    });
            if (phase() !== 'loading') throw createAppError('INVARIANT');
            lifecycle.current = { kind: 'prepared' };
            return {
              kind: 'fresh',
              recording,
              endFeed: async (reason) => {
                if (phase() !== 'prepared' || recording === null)
                  throw createAppError('INVARIANT');
                lifecycle.current = { kind: 'ending' };
                const result = await endRecordingFeed(tx, {
                  recordingId: input.change.recordingId,
                  reason,
                  now,
                  ports,
                });
                if (phase() !== 'ending') throw createAppError('INVARIANT');
                lifecycle.current = { kind: 'ended' };
                return result;
              },
              settle: async (value) => {
                if (phase() !== 'ended') throw createAppError('INVARIANT');
                lifecycle.current = { kind: 'settling' };
                const result =
                  contentModerationCommandResultSchema.parse(value);
                await writeReceipt(tx, input, null, {
                  action: input.change.action,
                  result,
                });
                if (phase() !== 'settling') throw createAppError('INVARIANT');
                if (!input.live()) throw createAppError('CONFLICT');
                lifecycle.current = { kind: 'settled', result };
              },
            };
          };
          try {
            await work({ load });
            if (
              lifecycle.current.kind !== 'settled' &&
              lifecycle.current.kind !== 'replayed'
            )
              throw createAppError('INVARIANT');
            if (lifecycle.current.kind === 'settled' && !input.live())
              throw createAppError('CONFLICT');
            return lifecycle.current.result;
          } finally {
            lifecycle.current = { kind: 'closed' };
          }
        }),
      ),
    /** Fresh application fallback runs under the existing receipt and owner fences. */
    chatRemovalCommand: (
      input: Omit<ModerationCommandInput, 'change'> & {
        readonly change: Extract<
          ContentModerationChange,
          { action: 'chat_message.remove' }
        >;
      },
      work: (removers: ChatRemovalPorts) => Promise<ContentModerationOutcome>,
    ): Promise<ContentModerationCommandResult> =>
      instrumented(eventSink, 'runModerationCommand', () =>
        inTransaction(database, async (tx) => {
          await commandGate(tx, input.commandId);
          const stored = await storedResult(
            tx,
            input.commandId,
            input.requestDigest,
          );
          if (stored) return contentModerationCommandResultSchema.parse(stored);
          const now = await dbNow(tx);
          const state: { phase: ChatRemovalPhase } = { phase: 'ready' };
          const phase = () => state.phase;
          const remove = (owner: ChatMessageModeration) => async () => {
            if (phase() !== 'ready') throw createAppError('INVARIANT');
            state.phase = 'removing';
            const result = await owner.remove(tx, {
              messageId: input.change.messageId,
              now,
            });
            if (phase() !== 'removing') throw createAppError('INVARIANT');
            state.phase = result === null ? 'ready' : 'found';
            return result;
          };
          const runFallback = async () => {
            try {
              const result = await work({
                spectator: remove(ports.chat),
                floor: remove(ports.floor),
                room: remove(ports.roomChat),
              });
              if (
                phase() === 'removing' ||
                (result !== null && phase() !== 'found')
              )
                throw createAppError('INVARIANT');
              return result;
            } finally {
              state.phase = 'closed';
            }
          };
          const outcome = await runFallback();
          if (outcome === null) throw createAppError('NOT_FOUND');
          const result = contentModerationCommandResultSchema.parse({
            v: 1,
            outcome,
          });
          await writeReceipt(tx, input, null, {
            action: 'chat_message.remove',
            result,
          });
          if (!input.live()) throw createAppError('CONFLICT');
          return result;
        }),
      ),
    runModerationCommand: (
      input: Omit<ModerationCommandInput, 'change'> & {
        readonly change: Exclude<
          ContentModerationChange,
          {
            action:
              | 'recording.takedown'
              | 'recording.remove'
              | 'recording.legal_remove'
              | 'chat_message.remove';
          }
        >;
      },
    ): Promise<ContentModerationCommandResult> =>
      instrumented(eventSink, 'runModerationCommand', () =>
        inTransaction(database, async (tx) => {
          await commandGate(tx, input.commandId);
          const stored = await storedResult(
            tx,
            input.commandId,
            input.requestDigest,
          );
          if (stored) return contentModerationCommandResultSchema.parse(stored);
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
          await writeReceipt(tx, input, targetUserId, receipt);
          // Checked last: a command delayed past its deadline writes nothing.
          if (!input.live()) throw createAppError('CONFLICT');
          return contentModerationCommandResultSchema.parse(receipt.result);
        }),
      ),
    /** Photos an operator must decide, oldest first. */
    listProfilePhotoReviews: () =>
      instrumented(eventSink, 'listProfilePhotoReviews', () =>
        publicProfileModeration.listInReview(
          database,
          PROFILE_PHOTO_REVIEWS_MAX,
        ),
      ),
    /** Where a live photo's image is, for the operator's view of it. */
    readOperatorProfilePhoto: (photoId: string) =>
      instrumented(eventSink, 'readOperatorProfilePhoto', () =>
        publicProfileModeration.readOperatorPhoto(database, photoId),
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
        const [row] = await queryRows(
          database,
          z.object({ banned: z.boolean(), seconds: z.number().nullable() }),
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
