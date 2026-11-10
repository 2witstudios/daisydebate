import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  defaultNotificationChoices,
  notificationChoicePairs,
  notificationKinds,
  notificationPreferencesSchema,
} from './notifications';

setupRitewayBun();

test('notification kinds', () => {
  assert({
    given: 'the accepted kinds (WATCH-12, ADR 0124)',
    should: 'name Watch’s two released events, a Room invitation and a received challenge',
    actual: notificationKinds,
    expected: [
      'followed_debater_live',
      'recording_ready',
      'room_invitation',
      'challenge_received',
    ],
  });
});

test('choice pairs', () => {
  assert({
    given: 'the channels each kind is sent on',
    should: 'offer email only for invitations and challenges',
    actual: notificationChoicePairs.map(
      ({ kind, channel }) => `${kind}.${channel}`,
    ),
    expected: [
      'followed_debater_live.in_app',
      'recording_ready.in_app',
      'room_invitation.in_app',
      'room_invitation.email',
      'challenge_received.in_app',
      'challenge_received.email',
    ],
  });
});

test('preferences schema', () => {
  assert({
    given: 'every choice',
    should: 'parse',
    actual: notificationPreferencesSchema.safeParse({
      version: 1,
      choices: defaultNotificationChoices,
    }).success,
    expected: true,
  });
  assert({
    given: 'an email switch for a kind never emailed',
    should: 'refuse it',
    actual: notificationPreferencesSchema.safeParse({
      version: 1,
      choices: {
        ...defaultNotificationChoices,
        recording_ready: { in_app: true, email: false },
      },
    }).success,
    expected: false,
  });
});
