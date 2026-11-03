import { z } from 'zod';
import { idSchema } from './primitives';

/** The longest spectator chat message, in UTF-16 units. A DM may be longer. */
export const SPECTATOR_CHAT_UNITS = 500;

/** How many released messages one audience snapshot carries. */
export const SPECTATOR_CHAT_WINDOW = 50;

export const audienceReactionKinds = [
  'sharp_point',
  'good_rebuttal',
  'needs_evidence',
  'clear_structure',
] as const;
export type AudienceReactionKind = (typeof audienceReactionKinds)[number];

export const spectatorChatPostSchema = z.strictObject({
  version: z.literal(1),
  requestId: idSchema,
  text: z
    .string()
    .refine((text) => text.length <= SPECTATOR_CHAT_UNITS)
    .refine((text) => text.trim().length > 0),
});
export type SpectatorChatPost = z.infer<typeof spectatorChatPostSchema>;

export const audienceReactionPostSchema = z.strictObject({
  version: z.literal(1),
  kind: z.enum(audienceReactionKinds),
});

/**
 * A tab's random token, counted into an irreversible sketch and never stored.
 * It belongs to no account and is not a cookie.
 */
export const viewerPulseSchema = z.strictObject({
  version: z.literal(1),
  token: idSchema,
});

/**
 * A released message. A removed or erased one keeps its place with no text and
 * no author, so the order holds and nothing of it survives.
 */
export const spectatorChatMessageSchema = z.strictObject({
  id: idSchema,
  sequence: z.number().int().positive(),
  at: z.iso.datetime(),
  author: z.string().nullable(),
  text: z.string().nullable(),
});
export type SpectatorChatMessage = z.infer<typeof spectatorChatMessageSchema>;

/**
 * The audience's own activity on a Round, on the spectator timeline: only what
 * has been released, the same for everyone. `viewers` is null when no count is
 * released; there is no such thing as a live one.
 */
export const audienceSnapshotSchema = z.strictObject({
  version: z.literal(1),
  roundId: idSchema,
  interaction: z.enum(['open', 'closed', 'unavailable']),
  messages: z.array(spectatorChatMessageSchema).max(SPECTATOR_CHAT_WINDOW),
  reactions: z.array(
    z.strictObject({
      kind: z.enum(audienceReactionKinds),
      count: z.number().int().nonnegative(),
    }),
  ),
  viewers: z.number().int().nonnegative().nullable(),
});
export type AudienceSnapshot = z.infer<typeof audienceSnapshotSchema>;

export const debaterFollowUpdateSchema = z.strictObject({
  version: z.literal(1),
  username: z.string().min(1).max(64),
  state: z.enum(['following', 'not_following']),
});

export const watchHistoryUpdateSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    version: z.literal(1),
    kind: z.literal('watched'),
    roundId: idSchema,
  }),
  z.strictObject({
    version: z.literal(1),
    kind: z.literal('forget'),
    roundId: idSchema,
  }),
  z.strictObject({ version: z.literal(1), kind: z.literal('clear') }),
]);

export const notificationKinds = [
  'followed_debater_live',
  'recording_ready',
] as const;
export type NotificationKind = (typeof notificationKinds)[number];

export const notificationsReadSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    version: z.literal(1),
    kind: z.literal('one'),
    notificationId: idSchema,
  }),
  z.strictObject({ version: z.literal(1), kind: z.literal('all') }),
]);

export const notificationPreferencesSchema = z.strictObject({
  version: z.literal(1),
  followed_debater_live: z.boolean(),
  recording_ready: z.boolean(),
});
export type NotificationPreferences = z.infer<
  typeof notificationPreferencesSchema
>;
