import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  initialPresenceForm,
  presenceFields,
  presenceFormUnavailable,
  presenceSet,
} from './form';

setupRitewayBun();

test('a status answer is one kind, and the form shows only what it holds', () => {
  const answers = [
    initialPresenceForm,
    presenceSet('busy'),
    presenceFormUnavailable(),
  ];
  assert({
    given: 'nothing posted, a status that was set, and a call that failed',
    should:
      'be idle with nothing to show, set with the new status and no notice, and refused with the notice and no status',
    actual: answers.map((answer) => [answer.kind, presenceFields(answer)]),
    expected: [
      ['idle', { status: undefined, notice: undefined }],
      ['set', { status: 'busy', notice: undefined }],
      [
        'refused',
        {
          status: undefined,
          notice: 'Could not change your status. Try again.',
        },
      ],
    ],
  });
});
