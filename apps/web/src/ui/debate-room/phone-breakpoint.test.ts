import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { phoneMediaQuery } from './phone-breakpoint';

setupRitewayBun();

const style = (token: string) => ({
  getPropertyValue: (name: string) =>
    name === '--breakpoint-compact' ? token : '',
});

describe('phoneMediaQuery', () => {
  test('the globals.css token', () => {
    assert({
      given: 'the computed --breakpoint-compact token',
      should: 'build the matching range query',
      actual: phoneMediaQuery(style(' 840px ')),
      expected: '(width < 840px)',
    });
  });

  test('a missing token', () => {
    assert({
      given: 'a computed style without the token',
      should: 'fall back to the documented 901px default',
      actual: phoneMediaQuery(style('')),
      expected: '(width < 901px)',
    });
  });
});
