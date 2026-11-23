import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { proseLinks, proseRuns } from './prose';

setupRitewayBun();

describe('proseRuns', () => {
  test('text and local links', () => {
    assert({
      given: 'copy with a link in the middle',
      should: 'split it into text, the link and the rest',
      actual: proseRuns('Open [Judge](/judge) to see it.'),
      expected: [
        { kind: 'text', text: 'Open ' },
        { kind: 'link', text: 'Judge', href: '/judge' },
        { kind: 'text', text: ' to see it.' },
      ],
    });
  });

  test('only local paths link', () => {
    assert({
      given:
        'a link to another site, a protocol-relative link and plain brackets',
      should: 'leave all three as text',
      actual: proseRuns(
        'See [x](https://example.com), [z](//example.com) or [y].',
      ),
      expected: [
        {
          kind: 'text',
          text: 'See [x](https://example.com), [z](//example.com) or [y].',
        },
      ],
    });
  });
});

describe('proseLinks', () => {
  test('every link, in order', () => {
    assert({
      given: 'copy with two links, one with a fragment',
      should: 'list both paths',
      actual: proseLinks('[a](/help#judging) then [b](/guides/judging)'),
      expected: ['/help#judging', '/guides/judging'],
    });
  });
});
