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
  'friendship',
] as const;
export type NotificationSubjectKind = (typeof notificationSubjects)[number];

/**
 * How a kind reaches a member (ADR 0144). An urgent kind needs the member now
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
  // The debate's clock is running: the member is needed in it now.
  round_started: { subject: 'round', urgency: 'urgent' },
  round_decision_released: {
    subject: 'round',
    urgency: 'durable',
    email: 'batched',
  },
  room_invitation: {
    subject: 'room_invitation',
    urgency: 'durable',
    email: 'batched',
  },
  // A challenge stands for two minutes: it needs the member now, or never.
  challenge_received: { subject: 'challenge', urgency: 'urgent' },
  challenge_accepted: { subject: 'challenge', urgency: 'urgent' },
  friend_request_received: {
    subject: 'friendship',
    urgency: 'durable',
    email: 'batched',
  },
  friend_request_accepted: {
    subject: 'friendship',
    urgency: 'durable',
    email: 'none',
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
export const emailedNotificationKinds = notificationKinds.filter(
  emailsKind,
) as [EmailedNotificationKind, ...EmailedNotificationKind[]];

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

/**
 * How a member is told while Daisy is open, and whether Daisy emails them at
 * all (ADR 0144): toasts, a sound and a desktop alert for urgent kinds, and
 * the one switch that stops every notification email whatever each kind's
 * own email choice says. None of these changes what the inbox stores.
 */
export const notificationPresentationSchema = z.strictObject({
  version: z.literal(1),
  toasts: z.boolean(),
  sound: z.boolean(),
  desktopAlerts: z.boolean(),
  email: z.boolean(),
});
export type NotificationPresentation = Omit<
  z.infer<typeof notificationPresentationSchema>,
  'version'
>;

/** What a member who never chose is given: everything on. */
export const defaultNotificationPresentation: NotificationPresentation = {
  toasts: true,
  sound: true,
  desktopAlerts: true,
  email: true,
};

/** The newest unread notifications the shell reads, for its toasts. */
export const NOTIFICATIONS_SHELL_RECENT = 10;

/**
 * What the app shell reads after its inbox rings (ADR 0144): the member's
 * unread count for the badge, their newest unread notifications in the words
 * the inbox uses (for toasts and alerts), and how they chose to be told. A
 * toast is a view of a stored row; this never carries anything the inbox
 * does not.
 */
export const notificationShellSchema = z.strictObject({
  version: z.literal(1),
  unread: z.int().nonnegative(),
  recent: z
    .array(
      z.strictObject({
        id: idSchema,
        kind: z.enum(notificationKinds),
        text: z.string().min(1).max(300),
        href: z.string().startsWith('/').max(300),
        surfacedAt: z.iso.datetime(),
      }),
    )
    .max(NOTIFICATIONS_SHELL_RECENT),
  presentation: notificationPresentationSchema.omit({ version: true }),
});
export type NotificationShell = z.infer<typeof notificationShellSchema>;
