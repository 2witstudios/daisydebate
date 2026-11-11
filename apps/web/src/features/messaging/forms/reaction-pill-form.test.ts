import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  initialReactionPill,
  reactionCounted,
  reactionMarked,
  reactionPillFields,
  reactionPillUnavailable,
  reactionWithdrawnUncounted,
  type ReactionPillState,
} from './reaction-pill-form';

setupRitewayBun();

test('a reaction pill answers exactly one outcome of its toggle', () => {
  const answers: readonly ReactionPillState[] = [
    initialReactionPill,
    reactionPillUnavailable(),
    reactionCounted(true, 2),
    reactionMarked(true),
    reactionWithdrawnUncounted,
  ];
  assert({
    given:
      'nothing posted, a refusal, an accepted change with its count, one without, and a withdrawal whose count could not be read again',
    should:
      'name its kind and render the notice, own mark and count that outcome alone carries',
    actual: answers.map((answer) => [answer.kind, reactionPillFields(answer)]),
    expected: [
      ['idle', { notice: undefined, own: undefined, count: undefined }],
      [
        'refused',
        {
          notice: 'Reaction could not be changed. Try again.',
          own: undefined,
          count: undefined,
        },
      ],
      ['counted', { notice: undefined, own: true, count: 2 }],
      ['marked', { notice: undefined, own: true, count: undefined }],
      [
        'uncounted',
        {
          notice: 'Reaction removed. Reload to see the current count.',
          own: false,
          count: undefined,
        },
      ],
    ],
  });
});
