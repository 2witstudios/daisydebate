import { z } from 'zod';
import { idSchema } from './primitives';

export const moderationKinds = ['warning', 'suspension', 'ban'] as const;

/** A member's own unread warning, shown once until they acknowledge it. */
const moderationNoticeSchema = z.strictObject({
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
