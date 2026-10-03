import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { acceptAiDebateCommand, aiDebateLongestMs } from './ai-debate';
import { s, start } from './ai-debate.test-support';

setupRitewayBun();

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
        command: { type: 'startSpeech', at: s(510) },
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
      given: 'a yield of the AC during its countdown',
      should: 'refuse it: a countdown cannot be skipped',
      actual: acceptAiDebateCommand({
        personSide: 'negative',
        commands: [start],
        command: { type: 'yield', at: s(5), turnIndex: 0 },
      }),
      expected: { ok: false, reason: 'turn-not-live' },
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

describe('aiDebateLongestMs', () => {
  test('every turn, countdown and the whole prep budget', () => {
    assert({
      given: 'strict IPDA',
      should: 'be 30 minutes of turns, 4 of prep and a countdown per turn',
      actual: aiDebateLongestMs(),
      expected: 34 * 60_000 + 7 * 10_000,
    });
  });
});
