import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  modeClass,
  roomColumnClass,
  roomGridClass,
  seatClass,
} from './room-row-class';

setupRitewayBun();

describe('room row classes', () => {
  test('grid', () => {
    assert({
      given: 'the shared room grid',
      should: 'use twelve columns, three on the phone',
      actual: roomGridClass,
      expected:
        'grid grid-cols-12 items-center gap-x-6 max-compact:grid-cols-3 max-compact:gap-x-3',
    });
  });

  test('columns', () => {
    assert({
      given: 'each column',
      should: 'span its share on desktop and stack beside the action on phone',
      actual: (['name', 'players', 'status', 'action'] as const).map(
        roomColumnClass,
      ),
      expected: [
        'col-span-4 min-w-0 max-compact:col-span-2',
        'col-span-4 max-compact:col-span-2',
        'col-span-2 max-compact:col-span-2',
        'col-span-2 max-compact:col-span-1 max-compact:col-start-3 max-compact:row-span-3 max-compact:row-start-1',
      ],
    });
  });

  test('mode and seat', () => {
    assert({
      given: 'each mode and seat state',
      should: 'color ranked in the accent and mute a placeholder seat',
      actual: [
        modeClass('ranked'),
        modeClass('casual'),
        seatClass(true),
        seatClass(false),
      ],
      expected: [
        'font-strong text-accent',
        'font-strong text-ink-muted',
        'text-ink',
        'text-ink-faint italic',
      ],
    });
  });
});
