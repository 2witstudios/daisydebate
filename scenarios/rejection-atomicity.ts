import type { DebateScenario } from '../scripts/scenario';

const scenario: DebateScenario = {
  name: 'rejection-atomicity',
  given: {
    clock: '2026-01-01T00:00:00.000Z',
    ids: ['11111111-1111-4111-8111-111111111111'],
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
    id: '11111111-1111-4111-8111-111111111111',
    createdAt: '2026-01-01T00:00:00.000Z',
    phase: 'waiting',
    participantIds: [],
  },
};

export default scenario;
