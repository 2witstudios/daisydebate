import { z } from 'zod';
import { idSchema } from './primitives';

/**
 * Reporting and moderation (WATCH-7): one report for a Round, a Recording, a
 * chat message or abusive ballot feedback. Reasons are closed per target, so a
 * report cannot carry free text or a reason its target does not have. Dispute
 * and integrity review is a reason on a Round or Recording, in the same queue.
 */
const safetyReasons = [
  'harassment',
  'hate',
  'sexual_content',
  'violence',
  'self_harm',
  'impersonation',
  'spam',
  'other',
] as const;
const reviewReasons = ['result_dispute', 'integrity_concern'] as const;
const feedbackReason = 'abusive_feedback';

const reportReasons = [
  ...safetyReasons,
  ...reviewReasons,
  feedbackReason,
] as const;
export type ReportReason = (typeof reportReasons)[number];

const footageReason = z.enum([...safetyReasons, ...reviewReasons]);

/** What an account may report, each target with exactly its own reasons. */
export const reportCreateSchema = z.discriminatedUnion('targetKind', [
  z.strictObject({
    targetKind: z.literal('round'),
    targetId: idSchema,
    reason: footageReason,
  }),
  z.strictObject({
    targetKind: z.literal('recording'),
    targetId: idSchema,
    reason: footageReason,
  }),
  z.strictObject({
    targetKind: z.literal('chat_message'),
    targetId: idSchema,
    reason: z.enum(safetyReasons),
  }),
  z.strictObject({
    targetKind: z.literal('ballot_feedback'),
    targetId: idSchema,
    reason: z.literal(feedbackReason),
  }),
]);
export type ReportCreate = z.infer<typeof reportCreateSchema>;
export type ReportTargetKind = ReportCreate['targetKind'];

export const reportTargetKinds = [
  'round',
  'recording',
  'chat_message',
  'ballot_feedback',
] as const satisfies readonly ReportTargetKind[];

/** The reasons a report form offers for a target, in display order. */
export const reasonsForTarget = (
  targetKind: ReportTargetKind,
): readonly ReportReason[] => {
  switch (targetKind) {
    case 'round':
    case 'recording':
      return [...safetyReasons, ...reviewReasons];
    case 'chat_message':
      return safetyReasons;
    case 'ballot_feedback':
      return [feedbackReason];
  }
};

/** The queue a reason lands in: review is about the result, safety about conduct. */
export const moderationQueues = ['safety', 'review'] as const;
export type ModerationQueue = (typeof moderationQueues)[number];
export const queueOfReason = (reason: ReportReason): ModerationQueue =>
  (reviewReasons as readonly string[]).includes(reason) ? 'review' : 'safety';

export const reportStatuses = ['open', 'upheld', 'dismissed'] as const;

/**
 * How fast a stop or a takedown must reach a connected viewer (DEC-303):
 * listing and delivery are gone within this bound.
 */
export const MODERATION_DELIVERY_BOUND_MS = 60_000;

/** Slow mode's seconds between one account's chat posts; 0 is off. */
export const chatSlowModeSchema = z.int().min(0).max(3_600);

const instant = z.iso.datetime();

/** One queue row. It names no reporter: the queue never shows who reported. */
export const moderationReportSchema = z.strictObject({
  reportId: idSchema,
  targetKind: z.enum(reportTargetKinds),
  targetId: idSchema,
  reason: z.enum(reportReasons),
  status: z.enum(reportStatuses),
  reportedAt: instant,
  resolvedAt: instant.nullable(),
});
export type ModerationReport = z.infer<typeof moderationReportSchema>;

export const moderationReportsQuerySchema = z.strictObject({
  queue: z.enum(moderationQueues),
  status: z.enum(reportStatuses),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(256).optional(),
});

/** The keyset position a page continues from, bound to its filter. */
export const moderationReportsCursorSchema = z.strictObject({
  v: z.literal(1),
  queue: z.enum(moderationQueues),
  status: z.enum(reportStatuses),
  reportedAt: z.iso.datetime(),
  reportId: idSchema,
});

export const moderationReportsPageSchema = z.strictObject({
  items: z.array(moderationReportSchema).max(100),
  nextCursor: z.string().max(256).nullable(),
});
export type ModerationReportsPage = z.infer<typeof moderationReportsPageSchema>;

/**
 * What the operator reads about a reported thing. Private feedback appears
 * here only because it was reported, and only the reported side's text.
 */
export const moderationSubjectSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('round'),
    roundId: idSchema,
    resolution: z.string(),
    competitionType: z.enum(['ranked', 'casual']),
    broadcastId: idSchema.nullable(),
    broadcastStopped: z.boolean(),
    chatSlowModeSeconds: chatSlowModeSchema,
  }),
  z.strictObject({ kind: z.literal('recording'), recordingId: idSchema }),
  z.strictObject({
    kind: z.literal('chat_message'),
    messageId: idSchema,
    /** Null once removed; the message's text is never kept after removal. */
    text: z.string().nullable(),
    authorUserId: idSchema.nullable(),
  }),
  z.strictObject({
    kind: z.literal('ballot_feedback'),
    ballotId: idSchema,
    side: z.enum(['affirmative', 'negative']),
    text: z.string().nullable(),
  }),
]);
export type ModerationSubject = z.infer<typeof moderationSubjectSchema>;

export const moderationReportDetailSchema = z.strictObject({
  report: moderationReportSchema,
  subject: moderationSubjectSchema.nullable(),
});
export type ModerationReportDetail = z.infer<
  typeof moderationReportDetailSchema
>;

const commandFields = {
  v: z.literal(1),
  commandId: idSchema,
  /** The admin audit chain head after this command's intent (cross-database anchor). */
  adminAuditHead: z.string().regex(/^[0-9a-f]{64}$/),
};

export const broadcastStopReasons = [
  'policy_violation',
  'legal_request',
  'participant_safety',
  'technical',
] as const;
export const recordingTakedownReasons = [
  'policy_violation',
  'legal_request',
  'participant_safety',
] as const;

/** Each operator moderation action: its own typed resource (ADR 0079). */
export const moderationCommands = {
  'report.resolve': z.strictObject({
    ...commandFields,
    outcome: z.enum(['upheld', 'dismissed']),
  }),
  'broadcast.stop': z.strictObject({
    ...commandFields,
    reason: z.enum(broadcastStopReasons),
  }),
  'broadcast.chat_slow_mode.update': z.strictObject({
    ...commandFields,
    seconds: chatSlowModeSchema,
  }),
  'recording.takedown': z.strictObject({
    ...commandFields,
    reason: z.enum(recordingTakedownReasons),
  }),
  'chat_message.remove': z.strictObject({ ...commandFields }),
  'account.audience_ban.update': z.strictObject({
    ...commandFields,
    state: z.enum(['banned', 'lifted']),
  }),
} as const;
export type ModerationAction = keyof typeof moderationCommands;
export const moderationActions = Object.keys(
  moderationCommands,
) as readonly ModerationAction[];

export type ModerationCommand<A extends ModerationAction> = z.infer<
  (typeof moderationCommands)[A]
>;

/** A repeat of a settled state is recorded as `unchanged`, never an error. */
export const moderationCommandResultSchema = z.strictObject({
  v: z.literal(1),
  outcome: z.enum(['applied', 'unchanged']),
});
export type ModerationCommandResult = z.infer<
  typeof moderationCommandResultSchema
>;

/** Moderation's variant of an operator command readback: its stored result. */
export const moderationCommandStateSchema = z.strictObject({
  action: z.enum([
    'report.resolve',
    'broadcast.stop',
    'broadcast.chat_slow_mode.update',
    'recording.takedown',
    'chat_message.remove',
    'account.audience_ban.update',
  ] satisfies ModerationAction[]),
  result: moderationCommandResultSchema,
});

/** The operator API's moderation routes (ADR 0079), each its own typed resource. */
export const moderationOperatorRoutes = {
  listReports: {
    method: 'GET',
    path: /^\/operator\/v1\/reports$/,
    query: ['queue', 'status', 'cursor', 'limit'],
  },
  readReport: {
    method: 'GET',
    path: /^\/operator\/v1\/reports\/([a-z0-9]{24})$/,
    query: [],
  },
  resolveReport: {
    method: 'PUT',
    path: /^\/operator\/v1\/reports\/([a-z0-9]{24})\/resolution$/,
    query: [],
  },
  stopBroadcast: {
    method: 'PUT',
    path: /^\/operator\/v1\/broadcasts\/([a-z0-9]{24})\/stop$/,
    query: [],
  },
  setChatSlowMode: {
    method: 'PUT',
    path: /^\/operator\/v1\/broadcasts\/([a-z0-9]{24})\/chat-slow-mode$/,
    query: [],
  },
  takeDownRecording: {
    method: 'PUT',
    path: /^\/operator\/v1\/recordings\/([a-z0-9]{24})\/takedown$/,
    query: [],
  },
  removeChatMessage: {
    method: 'PUT',
    path: /^\/operator\/v1\/chat-messages\/([a-z0-9]{24})\/removal$/,
    query: [],
  },
  setAudienceBan: {
    method: 'PUT',
    path: /^\/operator\/v1\/accounts\/([a-z0-9]{24})\/audience-ban$/,
    query: [],
  },
} as const;
