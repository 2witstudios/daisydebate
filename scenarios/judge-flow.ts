import type { DebateScenario } from '../scripts/scenario';

const scenario: DebateScenario = {
  name: 'judge-flow',
  unsupported:
    'The debate engine currently exposes no judge participant, ballot, or adjudication operation. Add a domain operation before encoding a judge-flow scenario.',
  given: {
    clock: '2026-01-01T00:00:00.000Z',
    ids: ['k2v9x0f4m8q3w1z7c5n6b4d2'],
    resolution: 'A representative resolution',
  },
  when: [],
  expect: {
    id: 'k2v9x0f4m8q3w1z7c5n6b4d2',
    createdAt: '2026-01-01T00:00:00.000Z',
    phase: 'waiting',
    participantIds: [],
  },
};

export default scenario;
