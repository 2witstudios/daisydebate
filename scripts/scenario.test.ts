import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  runScenario,
  ScenarioExpectationError,
  type DebateScenario,
} from './scenario';

setupRitewayBun();

/** The foundation round: two seats, two speeches, nobody judging. */
const roundId = 'k2v9x0f4m8q3w1z7c5n6b4d2';

const scenario: DebateScenario = {
  name: 'lifecycle',
  given: {
    ids: [
      roundId,
      'a7b3c9d1e5f2k4m6n8p1r3t5',
      'c8d4e2f6a1b3k5m7n9p2r4t6',
      'd5e8f2a4c6b1k3m7n9p2r4t6',
      'f1a3b5c7d9e2f4a6b8c1d3e5',
      'a1b2c3d4e5f6a7b8c9d0e1f2',
      'e1f2a3b4c5d6e7f8a9b0c1d2',
      'b0c1d2e3f4a5b6c7d8e9f0a1',
    ],
  },
  when: [
    { type: 'command', command: { type: 'start' }, actor: null },
    { type: 'tick', atMs: 10_000 }, // the AC opens
    { type: 'tick', atMs: 250_000 }, // the AC closes; the NC countdown runs
    { type: 'tick', atMs: 260_000 }, // the NC opens
  ],
  expect: {
    id: roundId,
    status: 'active',
    stage: 'live',
    opened: ['AC', 'NC'],
  },
};

describe('typed debate scenarios', () => {
  test('drives the engine with deterministic clock and identities', () => {
    const actual = runScenario(scenario);

    assert({
      given:
        'a typed lifecycle scenario with fixed identities and a movable clock',
      should: 'report the position the scenario asserts against',
      actual,
      expected: scenario.expect,
    });
  });

  test('rejects an expectation that does not match the engine result', () => {
    let error: unknown;
    try {
      runScenario({
        ...scenario,
        expect: { ...scenario.expect, status: 'completed' },
      });
    } catch (caught) {
      error = caught;
    }

    assert({
      given: 'a lifecycle scenario whose status expectation is violated',
      should:
        'report the failing expectation step with expected and actual values',
      actual: error instanceof ScenarioExpectationError ? error.report : error,
      expected: {
        type: 'scenario-expectation-failed',
        scenario: 'lifecycle',
        step: 'status',
        expected: 'completed',
        actual: 'active',
      },
    });
  });

  test('verifies rejected operations preserve state and identify the invariant', () => {
    const expected = {
      id: roundId,
      status: 'active' as const,
      stage: 'live' as const,
      opened: ['AC'],
    };
    const actual = runScenario({
      ...scenario,
      name: 'rejection-atomicity',
      when: [
        { type: 'command', command: { type: 'start' }, actor: null },
        { type: 'tick', atMs: 10_000 }, // the AC opens
        {
          type: 'expect-rejection',
          operation: {
            type: 'command',
            command: { type: 'start_speech' },
            actor: 1,
          },
          invariantId: 'round.speech.requires-prep',
        },
      ],
      expect: expected,
    });

    assert({
      given: 'a scenario containing a speech refused for want of prep',
      should: 'leave the AC as the only segment that opened',
      actual,
      expected,
    });
  });
});
