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
    given: 'the accepted kinds (WATCH-12, ADR 0124, ADR 0144)',
    should:
      'name Watch’s two released events, a Round starting and its decision, a Room invitation, a challenge and its acceptance, a friend request and its acceptance, and Tab’s tournament changes',
    actual: notificationKinds,
    expected: [
      'followed_debater_live',
      'recording_ready',
      'round_started',
      'round_decision_released',
      'room_invitation',
      'challenge_received',
      'challenge_accepted',
      'friend_request_received',
      'friend_request_accepted',
      'judge_assigned',
      'judge_replaced',
      'judge_unassigned',
      'tournament_draw_changed',
      'tournament_room_ready',
      'tournament_results_released',
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
      'round_started.in_app',
      'round_decision_released.in_app',
      'round_decision_released.email',
      'room_invitation.in_app',
      'room_invitation.email',
      'challenge_received.in_app',
      'challenge_accepted.in_app',
      'friend_request_received.in_app',
      'friend_request_received.email',
      'friend_request_accepted.in_app',
      'judge_assigned.in_app',
      'judge_replaced.in_app',
      'judge_unassigned.in_app',
      'tournament_draw_changed.in_app',
      'tournament_room_ready.in_app',
      'tournament_results_released.in_app',
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
    expected: [
      'round_decision_released',
      'room_invitation',
      'friend_request_received',
    ],
  });
  assert({
    given: 'a subject',
    should: 'name the kinds about it, in catalogue order',
    actual: [
      kindsAbout('round'),
      kindsAbout('challenge'),
      kindsAbout('friendship'),
      kindsAbout('fixture'),
    ],
    expected: [
      [
        'followed_debater_live',
        'recording_ready',
        'round_started',
        'round_decision_released',
      ],
      ['challenge_received', 'challenge_accepted'],
      ['friend_request_received', 'friend_request_accepted'],
      [
        'judge_assigned',
        'judge_replaced',
        'judge_unassigned',
        'tournament_draw_changed',
        'tournament_room_ready',
        'tournament_results_released',
      ],
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
