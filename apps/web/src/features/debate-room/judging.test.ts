import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  ballotLines,
  judgingBallotsOf,
  judgingClockOf,
  JUDGING_WINDOW_MS,
} from './judging';

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
      given: 'a practice round the AI judges',
      should: 'show one line: the AI judge’s ballot decides the result',
      actual: ballotLines({ judge: 'ai', ai: null }, 'practice'),
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
  const close = Date.parse('2026-10-12T18:00:00.000Z');

  test('the window after the last speech', () => {
    assert({
      given: 'the last speech closed 5 minutes ago',
      should: 'count down what is left of the 30-minute judging window',
      actual: [JUDGING_WINDOW_MS, judgingClockOf(close, close + 300_000)],
      expected: [
        1_800_000,
        { label: 'Judging window', remainingMs: 1_500_000 },
      ],
    });
  });

  test('a window that has run out', () => {
    assert({
      given: 'an instant past the window’s end',
      should: 'stop at zero rather than count negative',
      actual: judgingClockOf(close, close + 2_000_000).remainingMs,
      expected: 0,
    });
  });
});
