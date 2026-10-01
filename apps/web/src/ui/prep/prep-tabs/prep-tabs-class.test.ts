import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { prepTabClass } from './prep-tabs-class';

setupRitewayBun();

describe('prepTabClass', () => {
  test('selected and unselected', () => {
    assert({
      given: 'a selected and an unselected tab',
      should: 'underline only the selected one in the accent',
      actual: [prepTabClass(true), prepTabClass(false)],
      expected: [
        'flex min-h-12 items-center gap-2 border-b-3 px-4 text-base font-strong whitespace-nowrap no-underline hover:no-underline border-accent text-accent',
        'flex min-h-12 items-center gap-2 border-b-3 px-4 text-base font-strong whitespace-nowrap no-underline hover:no-underline border-transparent text-ink',
      ],
    });
  });
});
