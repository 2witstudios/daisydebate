import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { defaultEmail, newLinkFor, parseArgs } from './dev-login';

setupRitewayBun();

const mail = (to: string, link: string) =>
  JSON.stringify({ to, text: `Sign in: ${link}\nExpires soon.` });

describe('newLinkFor', () => {
  test('the newest message to the address after the lines already seen', () => {
    const lines = [
      mail('me@example.test', 'http://localhost:1/old'),
      mail('me@example.test', 'http://localhost:1/first'),
      mail('other@example.test', 'http://localhost:1/other'),
      mail('me@example.test', 'http://localhost:1/second'),
    ];
    assert({
      given: 'four captured lines, one already seen',
      should: 'return the newest link for that address',
      actual: newLinkFor(lines, 'Me@Example.test', 1),
      expected: 'http://localhost:1/second',
    });
  });

  test('nothing new yet', () => {
    assert({
      given: 'only lines that were already seen, or for someone else',
      should: 'find no link',
      actual: [
        newLinkFor(
          [mail('me@example.test', 'http://x/a')],
          'me@example.test',
          1,
        ),
        newLinkFor(
          [mail('other@example.test', 'http://x/a')],
          'me@example.test',
          0,
        ),
      ],
      expected: [null, null],
    });
  });

  test('a broken line is skipped', () => {
    assert({
      given: 'a half-written line before a good one',
      should: 'skip the broken line',
      actual: newLinkFor(
        ['{not json', mail('me@example.test', 'http://x/ok')],
        'me@example.test',
        0,
      ),
      expected: 'http://x/ok',
    });
  });
});

describe('newLinkFor with no address', () => {
  test('the newest link to anyone', () => {
    assert({
      given: 'links to two people',
      should: 'return the newest regardless of address',
      actual: newLinkFor(
        [
          mail('a@example.test', 'http://x/a'),
          mail('b@example.test', 'http://x/b'),
        ],
        null,
        0,
      ),
      expected: 'http://x/b',
    });
  });
});

describe('parseArgs', () => {
  test('defaults and flags', () => {
    assert({
      given: 'no arguments, an address, and the flags',
      should: 'default the address, and read print and latest',
      actual: [
        parseArgs([]),
        parseArgs(['a@example.test', '--print']),
        parseArgs(['--latest']),
        parseArgs(['a@example.test', '--latest']),
      ],
      expected: [
        { email: defaultEmail, print: false, latest: false },
        { email: 'a@example.test', print: true, latest: false },
        { email: null, print: false, latest: true },
        { email: 'a@example.test', print: false, latest: true },
      ],
    });
  });
});
