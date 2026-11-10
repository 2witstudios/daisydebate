import { assert, setupRitewayBun, test } from 'riteway/bun';
import { isSpokenPrefix, spokenPrefix } from './authored-speech';

setupRitewayBun();
const phrase = 'The affirmative has not shown any harm at all.';

test('a cut phrase keeps only the whole words fully played (ADR 0122)', () => {
  assert({
    given:
      'a nine-word phrase cut at none, a third, half, just short of all, all and past all',
    should:
      'keep only words fully played, never a half-played one, never more than the phrase holds',
    actual: [0, 1 / 3, 0.5, 0.99, 1, 1.4, Number.NaN].map((at) =>
      spokenPrefix(phrase, at),
    ),
    expected: [
      '',
      'The affirmative has',
      'The affirmative has not',
      'The affirmative has not shown any harm at',
      phrase,
      phrase,
      '',
    ],
  });
});

test('only a whole-word prefix of the authored text counts as spoken', () => {
  assert({
    given: 'a prefix, the whole, nothing, a changed word and an added word',
    should: 'accept only text the phrase said, in its order',
    actual: [
      isSpokenPrefix(phrase, 'The affirmative'),
      isSpokenPrefix(phrase, phrase),
      isSpokenPrefix(phrase, ''),
      isSpokenPrefix(phrase, 'The negative'),
      isSpokenPrefix(phrase, `${phrase} Indeed.`),
    ],
    expected: [true, true, true, false, false],
  });
});
