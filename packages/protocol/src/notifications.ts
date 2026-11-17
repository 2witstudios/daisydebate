import { z } from 'zod';
import { idSchema } from './primitives';

/**
 * What a notification can be about. Each subject's owner publishes whether it
 * still stands; a stored notification names exactly the one its kind requires.
 */
export const notificationSubjects = [
  'round',
  'room_invitation',
  'challenge',
] as const;
export type NotificationSubjectKind = (typeof notificationSubjects)[number];

/**
 * How a kind reaches a member (ADR 0143). An urgent kind needs the member now
 * (it may sound and raise a desktop alert while a tab is open) and is never
 * emailed: it would arrive after the moment. A durable kind can wait, and is
 * either in-app only or also gathered into the member's batched email.
 */
export type NotificationKindSpec =
  | {
      readonly subject: NotificationSubjectKind;
      readonly urgency: 'urgent';
      readonly email?: never;
    }
  | {
      readonly subject: NotificationSubjectKind;
      readonly urgency: 'durable';
      readonly email: 'none' | 'batched';
    };

/**
 * The notification catalogue: one entry per kind, and the one place a kind is
 * spelled. Every list, schema, default and stored check derives from it.
 * Watch's fan-out writes the first two from released facts (WATCH-12); the
 * others are written in the transaction that produced them (ADR 0124).
 */
export const notificationCatalogue = {
  followed_debater_live: {
    subject: 'round',
    urgency: 'durable',
    email: 'none',
  },
  recording_ready: { subject: 'round', urgency: 'durable', email: 'none' },
  room_invitation: {
    subject: 'room_invitation',
    urgency: 'durable',
    email: 'batched',
  },
  challenge_received: {
    subject: 'challenge',
    urgency: 'durable',
    email: 'batched',
  },
} as const satisfies Record<string, NotificationKindSpec>;

type Catalogue = typeof notificationCatalogue;
export type NotificationKind = keyof Catalogue;

/** The kinds, in catalogue order. */
export const notificationKinds = Object.keys(notificationCatalogue) as [
  NotificationKind,
  ...NotificationKind[],
];

/** The subject a kind names. */
export type SubjectOf<K extends NotificationKind> = Catalogue[K]['subject'];

export const subjectOf = <K extends NotificationKind>(kind: K): SubjectOf<K> =>
  notificationCatalogue[kind].subject;

/** The kinds that name one subject, in catalogue order. */
export const kindsAbout = (
  subject: NotificationSubjectKind,
): readonly NotificationKind[] =>
  notificationKinds.filter((kind) => subjectOf(kind) === subject);

/** A kind's entry, widened so its urgency and email can be compared. */
const specOf = (kind: NotificationKind): NotificationKindSpec =>
  notificationCatalogue[kind];

export const isUrgentNotificationKind = (kind: NotificationKind): boolean =>
  specOf(kind).urgency === 'urgent';

/** How a notification reaches a member: the inbox, or an email. */
export const notificationChannels = ['in_app', 'email'] as const;
export type NotificationChannel = (typeof notificationChannels)[number];

/** Kinds gathered into the member's email. */
export type EmailedNotificationKind = {
  [K in NotificationKind]: Catalogue[K] extends { readonly email: 'batched' }
    ? K
    : never;
}[NotificationKind];

const emailsKind = (kind: NotificationKind): kind is EmailedNotificationKind =>
  specOf(kind).email === 'batched';

/** Kinds sent by email, each with its own unsubscribe. */
export const emailedNotificationKinds = notificationKinds.filter(emailsKind) as [
  EmailedNotificationKind,
  ...EmailedNotificationKind[],
];

export const isEmailedNotificationKind = (
  kind: string,
): kind is EmailedNotificationKind =>
  (emailedNotificationKinds as readonly string[]).includes(kind);

/**
 * The channels each kind is delivered on. A kind has a preference only for a
 * channel it is really sent on, so no switch controls nothing.
 */
export const notificationChannelsOf = (
  kind: NotificationKind,
): readonly NotificationChannel[] =>
  emailsKind(kind) ? ['in_app', 'email'] : ['in_app'];

/** The most notifications one read names: the rows one inbox page shows. */
export const NOTIFICATIONS_READ_AT_ONCE = 50;

/**
 * Marks some of a member's own notifications read (one the member opened, or
 * those the page they are on shows), or all of them.
 */
export const notificationsReadSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    version: z.literal(1),
    kind: z.literal('some'),
    notificationIds: z.array(idSchema).min(1).max(NOTIFICATIONS_READ_AT_ONCE),
  }),
  z.strictObject({ version: z.literal(1), kind: z.literal('all') }),
]);

type InAppOnly = { readonly in_app: boolean };
type InAppAndEmail = { readonly in_app: boolean; readonly email: boolean };

/** Every channel of every kind, on or off. A missing stored choice is on. */
export type NotificationChoices = {
  readonly [K in NotificationKind]: K extends EmailedNotificationKind
    ? InAppAndEmail
    : InAppOnly;
};

const inAppOnly = z.strictObject({ in_app: z.boolean() });
const inAppAndEmail = z.strictObject({
  in_app: z.boolean(),
  email: z.boolean(),
});

export const notificationChoicesSchema = z.strictObject(
  Object.fromEntries(
    notificationKinds.map((kind) => [
      kind,
      emailsKind(kind) ? inAppAndEmail : inAppOnly,
    ]),
  ),
) as unknown as z.ZodType<NotificationChoices>;

/** Version 2: per kind and channel (ADR 0124); version 1 was one in-app switch per kind. */
export const notificationPreferencesSchema = z.strictObject({
  version: z.literal(2),
  choices: notificationChoicesSchema,
});
export type NotificationPreferences = z.infer<
  typeof notificationPreferencesSchema
>;

/** Every channel on: what a member who never chose receives. */
export const defaultNotificationChoices = Object.fromEntries(
  notificationKinds.map((kind) => [
    kind,
    emailsKind(kind) ? { in_app: true, email: true } : { in_app: true },
  ]),
) as unknown as NotificationChoices;

/** The (kind, channel) pairs a member can choose, in display order. */
export const notificationChoicePairs: readonly {
  readonly kind: NotificationKind;
  readonly channel: NotificationChannel;
}[] = notificationKinds.flatMap((kind) =>
  notificationChannelsOf(kind).map((channel) => ({ kind, channel })),
);
