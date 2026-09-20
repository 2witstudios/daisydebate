import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  runScenario,
  ScenarioExpectationError,
  type DebateScenario,
} from './scenario';

setupRitewayBun();

const scenario: DebateScenario = {
  name: 'lifecycle',
  given: {
    clock: '2026-01-01T00:00:00.000Z',
    ids: [
      'k2v9x0f4m8q3w1z7c5n6b4d2',
      'a7b3c9d1e5f2k4m6n8p1r3t5',
      'c8d4e2f6a1b3k5m7n9p2r4t6',
    ],
    resolution: 'A representative resolution',
  },
  when: [
    { type: 'join', participant: 1, side: 'affirmative' },
    { type: 'join', participant: 2, side: 'negative' },
    { type: 'ready', participant: 1 },
    { type: 'ready', participant: 2 },
    { type: 'transition', phase: 'active' },
    { type: 'transition', phase: 'completed' },
  ],
  expect: {
    phase: 'completed',
    participantIds: ['a7b3c9d1e5f2k4m6n8p1r3t5', 'c8d4e2f6a1b3k5m7n9p2r4t6'],
    createdAt: '2026-01-01T00:00:00.000Z',
    id: 'k2v9x0f4m8q3w1z7c5n6b4d2',
  },
};

describe('typed debate scenarios', () => {
  test('drives the engine with deterministic clock and identities', () => {
    const result = runScenario(scenario);

    assert({
      given: 'a typed lifecycle scenario with fixed time and identities',
      should: 'produce the expected debate snapshot',
      actual: {
        phase: result.phase,
        participantIds: result.participants.map(({ id }) => id),
        createdAt: result.createdAt,
        id: result.id,
      },
      expected: scenario.expect,
    });
  });

  test('rejects an expectation that does not match the engine result', () => {
    let error: unknown;
    try {
      runScenario({
        ...scenario,
        expect: { ...scenario.expect, phase: 'waiting' },
      });
    } catch (caught) {
      error = caught;
    }

    assert({
      given: 'a lifecycle scenario whose phase expectation is violated',
      should:
        'report the failing expectation step with expected and actual values',
      actual: error instanceof ScenarioExpectationError ? error.report : error,
      expected: {
        type: 'scenario-expectation-failed',
        scenario: 'lifecycle',
        step: 'phase',
        expected: 'waiting',
        actual: 'completed',
      },
    });
  });

  test('verifies rejected operations preserve state and identify the invariant', () => {
    const result = runScenario({
      ...scenario,
      name: 'rejection-atomicity',
      when: [
        {
          type: 'expect-rejection',
          operation: { type: 'transition', phase: 'active' },
          invariantId: 'debate.phase.active.requires-ready-participants',
        },
      ],
      expect: { ...scenario.expect, phase: 'waiting', participantIds: [] },
    });

    assert({
      given: 'a scenario containing a rejected active-phase transition',
      should: 'finish with the unchanged waiting snapshot',
      actual: { phase: result.phase, participantIds: result.participants },
      expected: { phase: 'waiting', participantIds: [] },
    });
  });
});
