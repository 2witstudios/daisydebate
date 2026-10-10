import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import {
  parsePreferenceForm,
  preferenceUnavailable,
  preferenceFormState,
} from './preference-form';
setupRitewayBun();
const channelId = 'c'.repeat(24);
test('native preferences require explicit choices and keep retry state', () => {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    operation: 'update',
    following: 'no',
    hidden: 'yes',
    notificationLevel: 'none',
  }))
    form.set(key, value);
  assert({
    given: 'a JavaScript-free explicit selection',
    should:
      'parse bounded choices without conferring permission and retain them after refusal',
    actual: [parsePreferenceForm(channelId, form), preferenceUnavailable(form)],
    expected: [
      {
        operation: 'update',
        command: {
          version: 1,
          channelId,
          following: false,
          hidden: true,
          notificationLevel: 'none',
        },
      },
      {
        following: 'no',
        hidden: 'yes',
        notificationLevel: 'none',
        notice:
          'Could not change these preferences. Your selections are kept; try again.',
      },
    ],
  });
});
test('clear does not create default selections and malformed/repeated choices refuse', async () => {
  const form = new FormData();
  form.set('operation', 'clear');
  assert({
    given: 'clearing an absent or revoked own preference',
    should: 'send scope only without invented choices',
    actual: parsePreferenceForm(channelId, form),
    expected: { operation: 'clear', command: { version: 1, channelId } },
  });
  for (const mutate of [
    () => form.set('operation', 'update'),
    () => {
      form.set('following', 'yes');
      form.append('following', 'no');
    },
  ]) {
    mutate();
    await assertRejects({
      given: 'missing or repeated native selections',
      should: 'refuse before mutation',
      actual: async () => parsePreferenceForm(channelId, form),
      code: 'VALIDATION',
    });
  }
});

test('successful clear discards submitted choices while saved answers keep actual durable choices', () => {
  assert({
    given: 'a saved row followed by successful row deletion',
    should: 'render unset selections rather than the prior submitted values',
    actual: [
      preferenceFormState({
        following: false,
        hidden: true,
        notificationLevel: 'none',
        readSequence: 9,
      }),
      preferenceFormState(null),
    ],
    expected: [
      { following: 'no', hidden: 'yes', notificationLevel: 'none' },
      { following: '', hidden: '', notificationLevel: '' },
    ],
  });
});
