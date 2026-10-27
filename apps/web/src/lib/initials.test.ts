import { assert, setupRitewayBun, test } from 'riteway/bun';
import { initialsOf } from './initials';

setupRitewayBun();

test('initials come from up to two words of a name (ISSUE-731)', () => {
  assert({
    given: 'display names with two, three and extra spaces',
    should: 'take the first letter of the first two words, capitalised',
    actual: ['Maya Okafor', 'Ana  de Souza', '  Ada Lovelace Byron'].map(
      initialsOf,
    ),
    expected: ['MO', 'AD', 'AL'],
  });
});

test('a single name gives one initial; a handle splits on its separators', () => {
  assert({
    given:
      'a one-word name, hyphenated and dotted handles, and a hyphenated given name',
    should:
      'give one letter for one word, read a handle by its parts, and keep spaces first',
    actual: [
      'penny',
      'debater-a',
      'your-own-debate',
      'ada.byron',
      'Mary-Jane Watson',
    ].map(initialsOf),
    expected: ['P', 'DA', 'YO', 'AB', 'MW'],
  });
});

test('a blank name has no initials', () => {
  assert({
    given: 'an empty and a whitespace-only name',
    should: 'return an empty string',
    actual: ['', '   '].map(initialsOf),
    expected: ['', ''],
  });
});
