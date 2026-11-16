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
    should:
      'name released Watch events, invitations, challenges and tournament changes',
    actual: notificationKinds,
    expected: [
      'judge_assigned',
      'judge_replaced',
      'judge_unassigned',
      'tournament_draw_changed',
      'tournament_room_ready',
      'tournament_results_released',
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
      'judge_assigned.in_app',
      'judge_replaced.in_app',
      'judge_unassigned.in_app',
      'tournament_draw_changed.in_app',
      'tournament_room_ready.in_app',
      'tournament_results_released.in_app',
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
