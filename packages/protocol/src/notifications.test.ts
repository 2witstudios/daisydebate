import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  defaultNotificationChoices,
  emailedNotificationKinds,
  kindsAbout,
  notificationChoicePairs,
  notificationKinds,
  notificationPreferencesSchema,
  type NotificationKindSpec,
} from './notifications';

setupRitewayBun();

test('notification kinds', () => {
  assert({
    given: 'the accepted kinds (WATCH-12, ADR 0124, ADR 0143)',
    should:
      'name Watch’s two released events, a Room invitation, a challenge and its acceptance, and a friend request and its acceptance',
    actual: notificationKinds,
    expected: [
      'followed_debater_live',
      'recording_ready',
      'room_invitation',
      'challenge_received',
      'challenge_accepted',
      'friend_request_received',
      'friend_request_accepted',
    ],
  });
});

test('choice pairs', () => {
  assert({
    given: 'the channels each kind is sent on',
    should: 'offer email only for the kinds gathered into email',
    actual: notificationChoicePairs.map(
      ({ kind, channel }) => `${kind}.${channel}`,
    ),
    expected: [
      'followed_debater_live.in_app',
      'recording_ready.in_app',
      'room_invitation.in_app',
      'room_invitation.email',
      'challenge_received.in_app',
      'challenge_accepted.in_app',
      'friend_request_received.in_app',
      'friend_request_received.email',
      'friend_request_accepted.in_app',
    ],
  });
});

test('preferences schema', () => {
  assert({
    given: 'every choice',
    should: 'parse',
    actual: notificationPreferencesSchema.safeParse({
      version: 2,
      choices: defaultNotificationChoices,
    }).success,
    expected: true,
  });
  assert({
    given: 'a version 1 body, one in-app switch per kind',
    should: 'refuse it: version 2 changed the shape',
    actual: notificationPreferencesSchema.safeParse({
      version: 1,
      followed_debater_live: true,
      recording_ready: true,
    }).success,
    expected: false,
  });
  assert({
    given: 'an email switch for a kind never emailed',
    should: 'refuse it',
    actual: notificationPreferencesSchema.safeParse({
      version: 2,
      choices: {
        ...defaultNotificationChoices,
        recording_ready: { in_app: true, email: false },
      },
    }).success,
    expected: false,
  });
});

test('catalogue', () => {
  assert({
    given: 'the catalogue',
    should: 'derive the emailed kinds from each entry',
    actual: emailedNotificationKinds,
    expected: ['room_invitation', 'friend_request_received'],
  });
  assert({
    given: 'a subject',
    should: 'name the kinds about it, in catalogue order',
    actual: [
      kindsAbout('round'),
      kindsAbout('challenge'),
      kindsAbout('friendship'),
    ],
    expected: [
      ['followed_debater_live', 'recording_ready'],
      ['challenge_received', 'challenge_accepted'],
      ['friend_request_received', 'friend_request_accepted'],
    ],
  });
});

test('an urgent kind cannot be emailed', () => {
  // An urgent kind would reach the inbox after its moment; the type refuses it.
  const urgentEmailed = {
    subject: 'challenge',
    urgency: 'urgent',
    // @ts-expect-error an urgent kind has no email policy
    email: 'batched',
  } satisfies NotificationKindSpec;
  assert({
    given: 'an urgent entry written with an email policy',
    should: 'fail to type-check (the line above carries the expected error)',
    actual: urgentEmailed.urgency,
    expected: 'urgent',
  });
});
