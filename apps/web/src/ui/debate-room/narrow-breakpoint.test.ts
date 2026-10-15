import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { narrowMediaQuery } from './narrow-breakpoint';

setupRitewayBun();

const style = (token: string) => ({
  getPropertyValue: (name: string) =>
    name === '--breakpoint-narrow' ? token : '',
});

describe('narrowMediaQuery', () => {
  test('the globals.css token', () => {
    assert({
      given: 'the computed --breakpoint-narrow token',
      should: 'build the matching range query',
      actual: narrowMediaQuery(style(' 641px ')),
      expected: '(width < 641px)',
    });
  });

  test('a missing token', () => {
    assert({
      given: 'a computed style without the token',
      should: 'fall back to the documented 641px default',
      actual: narrowMediaQuery(style('')),
      expected: '(width < 641px)',
    });
  });
});
