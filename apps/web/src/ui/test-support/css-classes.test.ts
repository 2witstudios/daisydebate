import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { definesClass } from './css-classes';

setupRitewayBun();

const defined = (css: string, name = 'neutral'): boolean =>
  definesClass(css, name);

describe('definesClass', () => {
  test('accepts a standalone class selector in its usual forms', () => {
    assert({
      given:
        'a plain rule, a selector list, a pseudo-class, no space before the brace, a descendant, a child combinator, and a media block',
      should: 'treat the class as defined in every form',
      actual: [
        defined('.neutral { color: red; }'),
        defined('.neutral, .gold { color: red; }'),
        defined('.gold,\n.neutral { color: red; }'),
        defined('.neutral:hover { color: red; }'),
        defined('.neutral{color:red}'),
        defined('.neutral .dot { color: red; }'),
        defined('.tile > .neutral { color: red; }'),
        defined('@media (max-width: 10px) { .neutral { color: red; } }'),
      ],
      expected: [true, true, true, true, true, true, true, true],
    });
  });

  test('rejects lookalikes', () => {
    assert({
      given:
        'a compound-only selector either way round, a comment, a longer name, a shorter name, a declaration value, and a missing class',
      should: 'not treat the class as defined',
      actual: [
        defined('.other.neutral { color: red; }'),
        defined('.neutral.other { color: red; }'),
        defined('/* .neutral { } */ .gold { color: red; }'),
        defined('.neutrality { color: red; }'),
        defined('.neutral-ish { color: red; }'),
        defined('.gold { content: ".neutral {"; }'),
        defined('.gold { color: red; }'),
      ],
      expected: [false, false, false, false, false, false, false],
    });
  });

  test('matches hyphenated names literally', () => {
    assert({
      given: 'the in-debate presence class',
      should: 'match it exactly and not its prefix',
      actual: [
        defined('.in-debate { color: red; }', 'in-debate'),
        defined('.in-debate { color: red; }', 'in'),
      ],
      expected: [true, false],
    });
  });
});
