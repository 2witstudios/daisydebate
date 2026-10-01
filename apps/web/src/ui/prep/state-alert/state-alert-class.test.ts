import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { stateAlertClass, stateIconClass } from './state-alert-class';

setupRitewayBun();

describe('state alert classes', () => {
  test('one fill and icon colour per tone', () => {
    assert({
      given: 'danger, warning and info',
      should: 'tint red, gold and accent',
      actual: [
        stateAlertClass('danger'),
        stateAlertClass('warning'),
        stateAlertClass('info'),
        stateIconClass('danger'),
        stateIconClass('warning'),
        stateIconClass('info'),
      ],
      expected: [
        'flex items-start gap-3 rounded-md border p-4 border-live bg-live-soft',
        'flex items-start gap-3 rounded-md border p-4 border-gold-border bg-gold-soft',
        'flex items-start gap-3 rounded-md border p-4 border-border-strong bg-accent-soft',
        'text-live',
        'text-gold',
        'text-accent',
      ],
    });
  });
});
