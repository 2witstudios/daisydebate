import { assert, setupRitewayBun, test } from 'riteway/bun';
import { documentSearchQuery } from './search-query';

setupRitewayBun();

test('a member’s words become a safe prefix query', () => {
  assert({
    given: 'plain words, query syntax, other scripts and nothing at all',
    should: 'keep only letters and digits, each matched by prefix',
    actual: [
      documentSearchQuery('Carbon tax'),
      documentSearchQuery("x' | !y:* & (z)"),
      documentSearchQuery('Économie 日本'),
      documentSearchQuery('  !? '),
    ],
    expected: [
      'carbon:* & tax:*',
      'x:* & y:* & z:*',
      'économie:* & 日本:*',
      null,
    ],
  });
});

test('a word with combining marks stays one word', () => {
  assert({
    given: 'a Devanagari word, and a decomposed accent',
    should: 'keep each word whole and composed',
    actual: [documentSearchQuery('हिन्दी'), documentSearchQuery('cafe\u0301')],
    expected: ['हिन्दी:*', 'café:*'],
  });
});

test('a long search stays bounded', () => {
  assert({
    given: 'more words than the limit, and one very long word',
    should: 'keep the first eight and cut the long word',
    actual: [
      documentSearchQuery('a b c d e f g h i j')?.split(' & ').length,
      documentSearchQuery('x'.repeat(100))?.length,
    ],
    expected: [8, 66],
  });
});
