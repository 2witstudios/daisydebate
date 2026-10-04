import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  deriveAiDebate,
  aiDebateCountdownMs,
  aiDebatePrepMs,
  aiDebateTurns,
  turnRoles,
} from './ai-debate';
import { s, start } from './ai-debate.test-support';

setupRitewayBun();

describe('the AI debate turns', () => {
  test('the order and lengths', () => {
    assert({
      given: 'the turn table',
      should: 'list AC, CX, NC, CX, 1AR, NR, 2AR with their lengths in ms',
      actual: aiDebateTurns.map((turn) => `${turn.name}:${turn.durationMs}`),
      expected: [
        'AC:300000',
        'CX:180000',
        'NC:360000',
        'CX:180000',
        '1AR:300000',
        'NR:300000',
        '2AR:180000',
      ],
    });
    assert({
      given: 'the countdown into each turn',
      should: 'be ten seconds',
      actual: aiDebateCountdownMs,
      expected: 10000,
    });
    assert({
      given: 'the prep budget',
      should: 'be four minutes for the person',
      actual: aiDebatePrepMs,
      expected: 240000,
    });
  });

  test('who speaks and who asks', () => {
    assert({
      given: 'the first cross-examination with the person on the affirmative',
      should: 'have the AI (negative) ask and the person answer',
      actual: turnRoles(aiDebateTurns[1]!, 'affirmative'),
      expected: { speaker: 'ai', asker: 'ai', answerer: 'person' },
    });
    assert({
      given: 'the NC with the person on the affirmative',
      should: 'be spoken by the AI',
      actual: turnRoles(aiDebateTurns[2]!, 'affirmative').speaker,
      expected: 'ai',
    });
  });
});

describe('deriveAiDebate', () => {
  test('before and at the start', () => {
    assert({
      given: 'no commands',
      should: 'be waiting',
      actual: deriveAiDebate({
        personSide: 'negative',
        commands: [],
        now: s(5),
      }),
      expected: { phase: 'waiting' },
    });
    assert({
      given: 'a start at t and the time t',
      should: 'count down ten seconds into the AC',
      actual: deriveAiDebate({
        personSide: 'affirmative',
        commands: [start],
        now: s(0),
      }),
      expected: {
        phase: 'countdown',
        turnIndex: 0,
        startsAt: s(10),
        remainingMs: 10000,
        prepLeftMs: 240000,
      },
    });
    assert({
      given: 'the end of that countdown',
      should: 'have the AC live with five minutes left',
      actual: deriveAiDebate({
        personSide: 'affirmative',
        commands: [start],
        now: s(10),
      }),
      expected: {
        phase: 'live',
        turnIndex: 0,
        startedAt: s(10),
        endsAt: s(310),
        remainingMs: 300000,
        prepLeftMs: 240000,
      },
    });
  });

  test('turns advance by time', () => {
    assert({
      given: 'the person on the negative, 5 s after the AC ended',
      should: 'count down into the first CX with 5 s to go',
      actual: deriveAiDebate({
        personSide: 'negative',
        commands: [start],
        now: s(315),
      }),
      expected: {
        phase: 'countdown',
        turnIndex: 1,
        startsAt: s(320),
        remainingMs: 5000,
        prepLeftMs: 240000,
      },
    });
    assert({
      given: 'the person on the negative, 20 s into the first CX',
      should: 'have the first CX live with 2:40 left',
      actual: deriveAiDebate({
        personSide: 'negative',
        commands: [start],
        now: s(340),
      }),
      expected: {
        phase: 'live',
        turnIndex: 1,
        startedAt: s(320),
        endsAt: s(500),
        remainingMs: 160000,
        prepLeftMs: 240000,
      },
    });
  });

  test("prep runs before the person's own speech until they start it", () => {
    assert({
      given: 'the person on the negative, 20 s after the first CX ended',
      should: 'be in prep before the NC with 3:40 of prep left, no countdown',
      actual: deriveAiDebate({
        personSide: 'negative',
        commands: [start],
        now: s(520),
      }),
      expected: {
        phase: 'prep',
        turnIndex: 2,
        prepStartedAt: s(500),
        prepLeftMs: 220000,
      },
    });
    assert({
      given: 'a startSpeech 30 s into that prep',
      should: 'start the NC then and keep 3:30 of prep',
      actual: deriveAiDebate({
        personSide: 'negative',
        commands: [start, { type: 'startSpeech', at: s(530) }],
        now: s(540),
      }),
      expected: {
        phase: 'live',
        turnIndex: 2,
        startedAt: s(530),
        endsAt: s(890),
        remainingMs: 350000,
        prepLeftMs: 210000,
      },
    });
    assert({
      given: 'no startSpeech until all prep is gone',
      should: 'start the speech when prep runs out',
      actual: deriveAiDebate({
        personSide: 'negative',
        commands: [start],
        now: s(500 + 240 + 10),
      }),
      expected: {
        phase: 'live',
        turnIndex: 2,
        startedAt: s(740),
        endsAt: s(1100),
        remainingMs: 350000,
        prepLeftMs: 0,
      },
    });
  });

  test('a yield ends a turn early and the next begins', () => {
    assert({
      given: 'the AI yields the AC at 4:00 with the person on the negative',
      should: 'count down from 4:00 and start the CX ten seconds later',
      actual: deriveAiDebate({
        personSide: 'negative',
        commands: [start, { type: 'yield', at: s(240), turnIndex: 0 }],
        now: s(260),
      }),
      expected: {
        phase: 'live',
        turnIndex: 1,
        startedAt: s(250),
        endsAt: s(430),
        remainingMs: 170000,
        prepLeftMs: 240000,
      },
    });
  });

  test('the end and an abort', () => {
    // Five countdowns: every turn but the person's two prepped rebuttals.
    const affirmativeEnd =
      300 + 180 + 360 + 180 + 300 + 300 + 180 + 240 + 5 * 10;
    assert({
      given: 'the person on the affirmative, one second before that end',
      should: 'still be live in the 2AR',
      actual: deriveAiDebate({
        personSide: 'affirmative',
        commands: [start],
        now: s(affirmativeEnd - 1),
      }).phase,
      expected: 'live',
    });
    assert({
      given:
        'the person on the affirmative and every turn, countdown and all prep elapsed',
      should: 'be ended',
      actual: deriveAiDebate({
        personSide: 'affirmative',
        commands: [start],
        now: s(affirmativeEnd + 1),
      }).phase,
      expected: 'ended',
    });
    assert({
      given: 'an abort for a vendor failure',
      should: 'be aborted with that reason',
      actual: deriveAiDebate({
        personSide: 'affirmative',
        commands: [
          start,
          { type: 'abort', at: s(60), reason: 'vendor-failure' },
        ],
        now: s(61),
      }),
      expected: { phase: 'aborted', at: s(60), reason: 'vendor-failure' },
    });
  });
});
