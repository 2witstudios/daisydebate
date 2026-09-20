import type { DebateScenario } from '../scripts/scenario';

const scenario: DebateScenario = {
  name: 'rejection-atomicity',
  given: {
    clock: '2026-01-01T00:00:00.000Z',
    ids: ['k2v9x0f4m8q3w1z7c5n6b4d2'],
    resolution: 'A representative resolution',
  },
  when: [
    {
      type: 'expect-rejection',
      operation: { type: 'transition', phase: 'active' },
      invariantId: 'debate.phase.active.requires-ready-participants',
    },
  ],
  expect: {
    id: 'k2v9x0f4m8q3w1z7c5n6b4d2',
    createdAt: '2026-01-01T00:00:00.000Z',
    phase: 'waiting',
    participantIds: [],
  },
};

export default scenario;
