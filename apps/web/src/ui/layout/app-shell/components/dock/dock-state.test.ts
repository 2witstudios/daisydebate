import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { dockOpen } from './dock-state';

setupRitewayBun();

describe('dockOpen', () => {
  test('auto follows the screen; a choice wins', () => {
    assert({
      given: 'every state on a wide and a narrow screen',
      should: 'open on auto only when wide, and obey open and closed',
      actual: (['auto', 'open', 'closed'] as const).map((dock) => [
        dockOpen(dock, true),
        dockOpen(dock, false),
      ]),
      expected: [
        [true, false],
        [true, true],
        [false, false],
      ],
    });
  });
});
