import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { windowLabel } from './clock';

setupRitewayBun();

describe('windowLabel', () => {
  test('whole minutes and the rest', () => {
    assert({
      given: '120 and 90 seconds',
      should: 'say minutes when whole and seconds otherwise',
      actual: [windowLabel(120), windowLabel(90)],
      expected: ['2 min', '90 s'],
    });
  });
});
