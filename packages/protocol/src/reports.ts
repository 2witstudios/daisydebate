import { z } from 'zod';
import { idSchema } from './primitives';
import { usernameSchema as username } from './username';

/** The one reasons list, everywhere a member can report (ADR 0097). */
export const reportReasons = [
  'harassment',
  'hate',
  'cheating',
  'spam',
  'other',
] as const;
export type ReportReason = (typeof reportReasons)[number];
export const reportReasonLabels: Readonly<Record<ReportReason, string>> = {
  harassment: 'Harassment',
  hate: 'Hate speech',
  cheating: 'Cheating',
  spam: 'Spam',
  other: 'Other',
};

/** Where the report was made, the only evidence scope it carries. */
export const reportSurfaces = ['online', 'profile', 'watch'] as const;
export type ReportSurface = (typeof reportSurfaces)[number];

export const reportOutcomes = [
  'dismissed',
  'warned',
  'suspended',
  'banned',
] as const;
export type ReportOutcome = (typeof reportOutcomes)[number];

export const moderationKinds = ['warning', 'suspension', 'ban'] as const;
export type ModerationKind = (typeof moderationKinds)[number];

export const reportCommandSchema = z.strictObject({
  version: z.literal(1),
  username,
  reason: z.enum(reportReasons),
  surface: z.enum(reportSurfaces),
});
export const reportResultSchema = z.strictObject({
  version: z.literal(1),
  username: z.string(),
  state: z.literal('reported'),
});

/** A member's own unread warning, shown once until they acknowledge it. */
export const moderationNoticeSchema = z.strictObject({
  id: idSchema,
  kind: z.enum(moderationKinds),
  startsAt: z.iso.datetime(),
});
export type ModerationNotice = z.infer<typeof moderationNoticeSchema>;

export const moderationAcknowledgeSchema = z.strictObject({
  version: z.literal(1),
  id: idSchema,
});
export const moderationNoticesSchema = z.strictObject({
  notices: z.array(moderationNoticeSchema).max(5),
});
