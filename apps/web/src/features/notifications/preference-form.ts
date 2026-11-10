import {
  notificationChoicePairs,
  type NotificationChannel,
  type NotificationChoices,
  type NotificationKind,
} from '@daisy/protocol';

/** The form field of one kind's channel: `room_invitation.email`. */
export const choiceField = (
  kind: NotificationKind,
  channel: NotificationChannel,
) => `${kind}.${channel}`;

/**
 * The choices a submitted preferences form states: a checked box is on and
 * an unchecked one, which a native form leaves out, is off.
 */
export const choicesFromForm = (form: FormData): NotificationChoices => {
  const choices: Partial<
    Record<NotificationKind, Partial<Record<NotificationChannel, boolean>>>
  > = {};
  for (const { kind, channel } of notificationChoicePairs)
    choices[kind] = {
      ...choices[kind],
      [channel]: form.get(choiceField(kind, channel)) === 'on',
    };
  return choices as NotificationChoices;
};

/** A choice as stored: true when the kind's channel is on. */
export const chosen = (
  choices: NotificationChoices,
  kind: NotificationKind,
  channel: NotificationChannel,
): boolean =>
  (choices[kind] as Partial<Record<NotificationChannel, boolean>>)[channel] ??
  true;
