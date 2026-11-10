import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { judgingClockOf } from './judging-window';

setupRitewayBun();

describe('judgingClockOf', () => {
  const deadlineAt = new Date(600_000).toISOString();
  test('counts only a human window, to the persisted deadline', () => {
    assert({
      given: 'a human window',
      should: 'count down to the server deadline',
      actual: judgingClockOf({ state: 'human_window', deadlineAt }, 540_000),
      expected: { label: 'Judging window', remainingMs: 60_000 },
    });
    assert({
      given: 'a human window already past',
      should: 'stop at zero',
      actual: judgingClockOf({ state: 'human_window', deadlineAt }, 700_000)
        ?.remainingMs,
      expected: 0,
    });
    for (const state of [
      'ai_processing',
      'ai_failed',
      'held_by_writer',
    ] as const)
      assert({
        given: state,
        should: 'show no clock',
        actual: judgingClockOf({ state, deadlineAt }, 540_000),
        expected: null,
      });
    assert({
      given: 'no status from the server',
      should: 'invent nothing',
      actual: judgingClockOf(null, 540_000),
      expected: null,
    });
  });
});
