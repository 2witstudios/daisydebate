import { z } from 'zod';
import { idSchema } from './primitives';

/**
 * What a notification can be about (ADR 0124). Watch's fan-out writes the
 * first two from released facts (WATCH-12); a Room invitation and a received
 * challenge are written in the transaction that produced them.
 */
export const tournamentNotificationKinds = [
  'judge_assigned',
  'judge_replaced',
  'judge_unassigned',
  'tournament_draw_changed',
  'tournament_room_ready',
  'tournament_results_released',
] as const;
export type TournamentNotificationKind =
  (typeof tournamentNotificationKinds)[number];

export const notificationKinds = [
  ...tournamentNotificationKinds,
  'followed_debater_live',
  'recording_ready',
  'room_invitation',
  'challenge_received',
] as const;
export type NotificationKind = (typeof notificationKinds)[number];

/** How a notification reaches a member: the inbox, or an email. */
export const notificationChannels = ['in_app', 'email'] as const;
export type NotificationChannel = (typeof notificationChannels)[number];

/**
 * The channels each kind is delivered on. A kind has a preference only for a
 * channel it is really sent on, so no switch controls nothing.
 */
export const notificationChannelsOf = {
  judge_assigned: ['in_app'],
  judge_replaced: ['in_app'],
  judge_unassigned: ['in_app'],
  tournament_draw_changed: ['in_app'],
  tournament_room_ready: ['in_app'],
  tournament_results_released: ['in_app'],
  followed_debater_live: ['in_app'],
  recording_ready: ['in_app'],
  room_invitation: ['in_app', 'email'],
  challenge_received: ['in_app', 'email'],
} as const satisfies Record<NotificationKind, readonly NotificationChannel[]>;

/** Kinds sent by email, each with its own unsubscribe. */
export const emailedNotificationKinds = [
  'room_invitation',
  'challenge_received',
] as const satisfies readonly NotificationKind[];
export type EmailedNotificationKind = (typeof emailedNotificationKinds)[number];

export const isEmailedNotificationKind = (
  kind: string,
): kind is EmailedNotificationKind =>
  (emailedNotificationKinds as readonly string[]).includes(kind);

export const notificationsReadSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    version: z.literal(1),
    kind: z.literal('one'),
    notificationId: idSchema,
  }),
  z.strictObject({ version: z.literal(1), kind: z.literal('all') }),
]);

const inAppOnly = z.strictObject({ in_app: z.boolean() });
const inAppAndEmail = z.strictObject({
  in_app: z.boolean(),
  email: z.boolean(),
});

/** Every channel of every kind, on or off. A missing stored choice is on. */
export const notificationChoicesSchema = z.strictObject({
  judge_assigned: inAppOnly,
  judge_replaced: inAppOnly,
  judge_unassigned: inAppOnly,
  tournament_draw_changed: inAppOnly,
  tournament_room_ready: inAppOnly,
  tournament_results_released: inAppOnly,
  followed_debater_live: inAppOnly,
  recording_ready: inAppOnly,
  room_invitation: inAppAndEmail,
  challenge_received: inAppAndEmail,
});
export type NotificationChoices = z.infer<typeof notificationChoicesSchema>;

/** Version 2: per kind and channel (ADR 0124); version 1 was one in-app switch per kind. */
export const notificationPreferencesSchema = z.strictObject({
  version: z.literal(2),
  choices: notificationChoicesSchema,
});
export type NotificationPreferences = z.infer<
  typeof notificationPreferencesSchema
>;

/** Every channel on: what a member who never chose receives. */
export const defaultNotificationChoices: NotificationChoices = {
  judge_assigned: { in_app: true },
  judge_replaced: { in_app: true },
  judge_unassigned: { in_app: true },
  tournament_draw_changed: { in_app: true },
  tournament_room_ready: { in_app: true },
  tournament_results_released: { in_app: true },
  followed_debater_live: { in_app: true },
  recording_ready: { in_app: true },
  room_invitation: { in_app: true, email: true },
  challenge_received: { in_app: true, email: true },
};

/** The (kind, channel) pairs a member can choose, in display order. */
export const notificationChoicePairs: readonly {
  readonly kind: NotificationKind;
  readonly channel: NotificationChannel;
}[] = notificationKinds.flatMap((kind) =>
  notificationChannelsOf[kind].map((channel) => ({ kind, channel })),
);
