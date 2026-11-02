import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { ballotLines, judgingBallotsOf, judgingClockOf } from './judging';

setupRitewayBun();

describe('judgingBallotsOf', () => {
  test('the ballots a round is judged by', () => {
    assert({
      given: 'a human judge, the AI judge, and no judge seat',
      should:
        'name who decides, keep no AI ballot beside a human judge yet, and give none without a judge',
      actual: [
        judgingBallotsOf('human'),
        judgingBallotsOf('ai'),
        judgingBallotsOf(null),
      ],
      expected: [{ judge: 'human', ai: null }, { judge: 'ai', ai: null }, null],
    });
  });
});

describe('ballotLines', () => {
  test('a human judge on the ladder', () => {
    assert({
      given: 'a ranked round with a human judge and a ready AI ballot',
      should:
        'say the judge is writing the ballot that decides the rating, and the AI ballot opens with it',
      actual: ballotLines({ judge: 'human', ai: 'ready' }, 'ranked'),
      expected: [
        {
          title: 'Judge’s ballot',
          status: 'Writing · decides the rating',
          ready: false,
        },
        {
          title: 'AI ballot',
          status: 'Ready · opens with the judge’s',
          ready: true,
        },
      ],
    });
  });

  test('an AI ballot still being written', () => {
    assert({
      given: 'a casual round whose AI ballot beside the judge is unfinished',
      should: 'say both are writing and the judge decides the result',
      actual: ballotLines({ judge: 'human', ai: 'writing' }, 'casual').map(
        (line) => line.status,
      ),
      expected: [
        'Writing · decides the result',
        'Writing · opens with the judge’s',
      ],
    });
  });

  test('the AI judges', () => {
    assert({
      given: 'a casual round the AI judges',
      should: 'show one line: the AI judge’s ballot decides the result',
      actual: ballotLines({ judge: 'ai', ai: null }, 'casual'),
      expected: [
        {
          title: 'AI judge’s ballot',
          status: 'Writing · decides the result',
          ready: false,
        },
      ],
    });
  });

  test('no AI ballot kept beside a human judge', () => {
    assert({
      given: 'a human judge and no AI ballot',
      should: 'show the judge’s line alone',
      actual: ballotLines({ judge: 'human', ai: null }, 'ranked').length,
      expected: 1,
    });
  });
});

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

describe('ballotLines by server state', () => {
  const line = (state: Parameters<typeof ballotLines>[2]) =>
    ballotLines({ judge: 'ai', ai: null }, 'casual', state)[0]?.status;
  test('says what the Round is really waiting on', () => {
    assert({
      given: 'each state',
      should: 'label it truthfully',
      actual: [
        line('ai_processing'),
        line('ai_failed'),
        line('awaiting_attendance'),
        line('held_by_writer'),
        line('closing_transcript'),
      ],
      expected: [
        'Writing · decides the result',
        'Could not rule',
        'Waiting on attendance',
        'Waiting on a check-in',
        'Closing the transcript',
      ],
    });
  });
});
