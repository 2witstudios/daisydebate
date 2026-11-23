import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { staffMinimumBandOf } from './organization-facts';

setupRitewayBun();

describe('staffMinimumBandOf', () => {
  test('no row at the organization', () => {
    assert({
      given: 'an organization with no staff.minimum_band row',
      should: "answer the catalogue's default",
      actual: staffMinimumBandOf(null),
      expected: 'adult',
    });
  });
  test("the organization's own row", () => {
    assert({
      given: 'a row that lets 16-17 staff act',
      should: 'answer its value',
      actual: staffMinimumBandOf({ value: { value: '16-17' } }),
      expected: '16-17',
    });
  });
  test('a malformed row', () => {
    let threw = false;
    try {
      staffMinimumBandOf({ value: { value: 'any' } });
    } catch {
      threw = true;
    }
    assert({
      given: 'a stored value outside the key schema',
      should: 'refuse it rather than guess',
      actual: threw,
      expected: true,
    });
  });
});
