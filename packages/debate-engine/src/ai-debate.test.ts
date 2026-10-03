import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  acceptAiDebateCommand,
  deriveAiDebate,
  ipdaPrepMs,
  ipdaTurns,
  turnRoles,
  type AiDebateCommand,
} from './ai-debate';

setupRitewayBun();

const T0 = Date.UTC(2026, 9, 3, 18, 0, 0);
const s = (seconds: number) => T0 + seconds * 1000;
const start: AiDebateCommand = { type: 'start', at: T0 };

describe('ipda turns', () => {
  test('the strict IPDA order and lengths', () => {
    assert({
      given: 'the IPDA turn table',
      should: 'list AC, CX, NC, CX, 1AR, NR, 2AR with their lengths in ms',
      actual: ipdaTurns.map((turn) => `${turn.name}:${turn.durationMs}`),
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
      given: 'the IPDA prep budget',
      should: 'be four minutes for the person',
      actual: ipdaPrepMs,
      expected: 240000,
    });
  });

  test('who speaks and who asks', () => {
    assert({
      given: 'the first cross-examination with the person on the affirmative',
      should: 'have the AI (negative) ask and the person answer',
      actual: turnRoles(ipdaTurns[1]!, 'affirmative'),
      expected: { speaker: 'ai', asker: 'ai', answerer: 'person' },
    });
    assert({
      given: 'the NC with the person on the affirmative',
      should: 'be spoken by the AI',
      actual: turnRoles(ipdaTurns[2]!, 'affirmative').speaker,
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
      should: 'have the AC live with five minutes left',
      actual: deriveAiDebate({
        personSide: 'affirmative',
        commands: [start],
        now: s(0),
      }),
      expected: {
        phase: 'live',
        turnIndex: 0,
        startedAt: s(0),
        endsAt: s(300),
        remainingMs: 300000,
        prepLeftMs: 240000,
      },
    });
  });

  test('turns advance by time', () => {
    assert({
      given: 'the person on the negative, 5:30 after the start',
      should: 'have the first CX live, 30 seconds in',
      actual: deriveAiDebate({
        personSide: 'negative',
        commands: [start],
        now: s(330),
      }),
      expected: {
        phase: 'live',
        turnIndex: 1,
        startedAt: s(300),
        endsAt: s(480),
        remainingMs: 150000,
        prepLeftMs: 240000,
      },
    });
  });

  test("prep runs before the person's own speech until they start it", () => {
    assert({
      given: 'the person on the negative, 20 s after the first CX ended',
      should: 'be in prep before the NC with 3:40 of prep left',
      actual: deriveAiDebate({
        personSide: 'negative',
        commands: [start],
        now: s(500),
      }),
      expected: {
        phase: 'prep',
        turnIndex: 2,
        prepStartedAt: s(480),
        prepLeftMs: 220000,
      },
    });
    assert({
      given: 'a startSpeech 30 s into that prep',
      should: 'start the NC then and keep 3:30 of prep',
      actual: deriveAiDebate({
        personSide: 'negative',
        commands: [start, { type: 'startSpeech', at: s(510) }],
        now: s(520),
      }),
      expected: {
        phase: 'live',
        turnIndex: 2,
        startedAt: s(510),
        endsAt: s(870),
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
        now: s(480 + 240 + 10),
      }),
      expected: {
        phase: 'live',
        turnIndex: 2,
        startedAt: s(720),
        endsAt: s(1080),
        remainingMs: 350000,
        prepLeftMs: 0,
      },
    });
  });

  test('a yield ends a turn early and the next begins', () => {
    assert({
      given: 'the AI yields the AC at 4:00 with the person on the negative',
      should: 'start the CX at 4:00',
      actual: deriveAiDebate({
        personSide: 'negative',
        commands: [start, { type: 'yield', at: s(240), turnIndex: 0 }],
        now: s(250),
      }),
      expected: {
        phase: 'live',
        turnIndex: 1,
        startedAt: s(240),
        endsAt: s(420),
        remainingMs: 170000,
        prepLeftMs: 240000,
      },
    });
  });

  test('the end and an abort', () => {
    const affirmativeEnd = 300 + 180 + 360 + 180 + 300 + 300 + 180 + 240;
    assert({
      given:
        'the person on the affirmative and every turn and all prep elapsed',
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

describe('acceptAiDebateCommand', () => {
  test('legal commands', () => {
    assert({
      given: 'a start on an empty log',
      should: 'accept it',
      actual: acceptAiDebateCommand({
        personSide: 'negative',
        commands: [],
        command: start,
      }),
      expected: { ok: true },
    });
    assert({
      given: 'a startSpeech during prep',
      should: 'accept it',
      actual: acceptAiDebateCommand({
        personSide: 'negative',
        commands: [start],
        command: { type: 'startSpeech', at: s(490) },
      }),
      expected: { ok: true },
    });
  });

  test('illegal commands are refused', () => {
    assert({
      given: 'a second start',
      should: 'refuse it',
      actual: acceptAiDebateCommand({
        personSide: 'negative',
        commands: [start],
        command: start,
      }),
      expected: { ok: false, reason: 'already-started' },
    });
    assert({
      given: 'a startSpeech while a turn is live',
      should: 'refuse it as not in prep',
      actual: acceptAiDebateCommand({
        personSide: 'negative',
        commands: [start],
        command: { type: 'startSpeech', at: s(100) },
      }),
      expected: { ok: false, reason: 'not-in-prep' },
    });
    assert({
      given: 'a yield naming a turn that is not live',
      should: 'refuse it',
      actual: acceptAiDebateCommand({
        personSide: 'negative',
        commands: [start],
        command: { type: 'yield', at: s(100), turnIndex: 1 },
      }),
      expected: { ok: false, reason: 'turn-not-live' },
    });
    assert({
      given: 'a command earlier than the last one',
      should: 'refuse it as out of order',
      actual: acceptAiDebateCommand({
        personSide: 'negative',
        commands: [start, { type: 'yield', at: s(200), turnIndex: 0 }],
        command: { type: 'abort', at: s(100), reason: 'person' },
      }),
      expected: { ok: false, reason: 'out-of-order' },
    });
    assert({
      given: 'any command after the debate ended',
      should: 'refuse it',
      actual: acceptAiDebateCommand({
        personSide: 'negative',
        commands: [start, { type: 'abort', at: s(10), reason: 'person' }],
        command: { type: 'abort', at: s(20), reason: 'person' },
      }),
      expected: { ok: false, reason: 'finished' },
    });
  });
});
