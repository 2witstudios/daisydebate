import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { dayClass } from './week-class';

setupRitewayBun();

describe('dayClass', () => {
  test('trained and rest days', () => {
    assert({
      given: 'a trained and a rest day',
      should: 'fill only the trained one',
      actual: [dayClass(true), dayClass(false)],
      expected: [
        'inline-flex h-8 w-8 items-center justify-center rounded-round border text-sm border-transparent bg-accent text-accent-ink',
        'inline-flex h-8 w-8 items-center justify-center rounded-round border text-sm border-border text-ink-faint',
      ],
    });
  });
});
