import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { roomPanelClass } from './room-panel-class';

setupRitewayBun();

describe('roomPanelClass', () => {
  test('each state', () => {
    const closed = roomPanelClass({ open: false, hidden: false });
    const open = roomPanelClass({ open: true, hidden: false });
    const hidden = roomPanelClass({ open: false, hidden: true });
    assert({
      given: 'collapsed, open and hidden',
      should:
        'show a column on desktop, a sheet only when open, and nothing when hidden',
      actual: [
        closed.includes('border-l') && closed.includes('max-compact:hidden'),
        open.includes('max-compact:fixed') &&
          !open.includes('max-compact:hidden'),
        hidden.split(' ').includes('hidden'),
      ],
      expected: [true, true, true],
    });
  });
});
