import { defaultNotificationChoices } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { choicesFromForm, chosen } from './preference-form';

setupRitewayBun();

test('choicesFromForm', () => {
  const form = new FormData();
  form.set('followed_debater_live.in_app', 'on');
  form.set('room_invitation.in_app', 'on');
  form.set('friend_request_received.email', 'on');
  assert({
    given: 'a form with three boxes checked',
    should: 'turn those on and every other channel off',
    actual: choicesFromForm(form),
    expected: {
      judge_assigned: { in_app: false },
      judge_replaced: { in_app: false },
      judge_unassigned: { in_app: false },
      tournament_draw_changed: { in_app: false },
      tournament_room_ready: { in_app: false },
      tournament_results_released: { in_app: false },
      followed_debater_live: { in_app: true },
      recording_ready: { in_app: false },
      round_started: { in_app: false },
      round_decision_released: { in_app: false, email: false },
      room_invitation: { in_app: true, email: false },
      challenge_received: { in_app: false },
      challenge_accepted: { in_app: false },
      friend_request_received: { in_app: false, email: true },
      friend_request_accepted: { in_app: false },
    },
  });
});

test('chosen', () => {
  assert({
    given: 'the defaults',
    should: 'read a kind’s email as on',
    actual: chosen(defaultNotificationChoices, 'room_invitation', 'email'),
    expected: true,
  });
});
