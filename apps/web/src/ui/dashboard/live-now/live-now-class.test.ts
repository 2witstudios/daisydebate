import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { competitorClass } from './live-now-class';

setupRitewayBun();

const base = 'flex min-w-0 items-center gap-2';

describe('competitorClass', () => {
  test('home reads left to right', () => {
    assert({
      given: 'the home side',
      should: 'return only the base layout',
      actual: competitorClass('home'),
      expected: base,
    });
  });

  test('away mirrors the row and right-aligns', () => {
    assert({
      given: 'the away side',
      should: 'reverse the row and right-align the text',
      actual: competitorClass('away'),
      expected: `${base} flex-row-reverse text-right`,
    });
  });
});
