import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { runScenario, type DebateScenario } from './scenario';

setupRitewayBun();

const scenario: DebateScenario = {
  name: 'lifecycle',
  given: {
    clock: '2026-01-01T00:00:00.000Z',
    ids: [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
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
    participantIds: [
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    id: '11111111-1111-4111-8111-111111111111',
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
    expect(() =>
      runScenario({
        ...scenario,
        expect: { ...scenario.expect, phase: 'waiting' },
      }),
    ).toThrow(/expected .*but received/);
  });
});
