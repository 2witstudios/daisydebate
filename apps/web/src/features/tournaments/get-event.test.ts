import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { getEvent } from './get-event';
import { NOW } from './tournament.test-support';

setupRitewayBun();

describe('getEvent', () => {
  test('the viewer competes in Harvest Cup only', () => {
    assert({
      given:
        'Harvest Cup, an entered but not competing tournament, and an unknown id',
      should: 'return the event only for Harvest Cup',
      actual: [
        getEvent('harvest-cup', NOW)?.tournament.name,
        getEvent('autumn-open', NOW),
        getEvent('nope', NOW),
      ],
      expected: ['Harvest Cup', null, null],
    });
  });
});
