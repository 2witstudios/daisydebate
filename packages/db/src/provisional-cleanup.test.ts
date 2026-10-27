import { assert, setupRitewayBun, test } from 'riteway/bun';
import { purposePattern } from './provisional-cleanup';

setupRitewayBun();

test('a purpose prefix matches only that purpose, wildcards escaped (ISSUE-716)', () => {
  assert({
    given: 'a plain purpose, and one carrying LIKE wildcards and a backslash',
    should: 'end in ":%" and escape every wildcard so it matches literally',
    actual: [purposePattern('sign-in'), purposePattern('a_b%c\\d')],
    expected: ['sign-in:%', 'a\\_b\\%c\\\\d:%'],
  });
});
