import { assert, setupRitewayBun, test } from 'riteway/bun';
import { destinationOf, moved } from '../../forms/form-state';
import {
  initialRetainedDelete,
  retainedDeleteNotice,
  retainedDeleteRefused,
  retainedDeleteUnavailable,
  type RetainedDeleteState,
} from './retained-delete-form';

setupRitewayBun();

test('a retained delete answers exactly one of nothing yet, a refusal, or the move to Messages', () => {
  const answers: readonly RetainedDeleteState[] = [
    initialRetainedDelete,
    retainedDeleteRefused,
    retainedDeleteUnavailable(),
    moved('/messages'),
  ];
  assert({
    given: 'each answer the delete button can hold',
    should:
      'name its kind, and carry a notice only when refused and a destination only when moved',
    actual: answers.map((answer) => [
      answer.kind,
      retainedDeleteNotice(answer),
      destinationOf(answer),
    ]),
    expected: [
      ['idle', undefined, undefined],
      ['refused', 'Could not delete this conversation. Try again.', undefined],
      ['refused', 'Could not reach Daisy. Try again.', undefined],
      ['moved', undefined, '/messages'],
    ],
  });
});
