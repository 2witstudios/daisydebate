import { defaultNotificationChoices } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { choicesFromForm, chosen } from './preference-form';

setupRitewayBun();

test('choicesFromForm', () => {
  const form = new FormData();
  form.set('followed_debater_live.in_app', 'on');
  form.set('room_invitation.in_app', 'on');
  form.set('challenge_received.email', 'on');
  assert({
    given: 'a form with three boxes checked',
    should: 'turn those on and every other channel off',
    actual: choicesFromForm(form),
    expected: {
      followed_debater_live: { in_app: true },
      recording_ready: { in_app: false },
      room_invitation: { in_app: true, email: false },
      challenge_received: { in_app: false, email: true },
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
