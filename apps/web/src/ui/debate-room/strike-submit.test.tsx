import { assert, setupRitewayBun, test } from 'riteway/bun';
import { strikePress } from './strike-submit';

setupRitewayBun();

test('the confirm posts only the resolution it named (PR #472 review)', () => {
  assert({
    given:
      'a first press with a choice, a press after changing the choice, a press on the named choice, and a press with no choice',
    should:
      'ask about each new choice and post only the one the prompt named, leaving a no-choice press to native validation',
    actual: [
      strikePress(null, '2'),
      strikePress('2', '3'),
      strikePress('2', '2'),
      strikePress(null, null),
    ],
    expected: [
      { kind: 'ask', position: '2' },
      { kind: 'ask', position: '3' },
      { kind: 'post' },
      { kind: 'post' },
    ],
  });
});
