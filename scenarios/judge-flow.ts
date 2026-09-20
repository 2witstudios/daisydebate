import type { DebateScenario } from '../scripts/scenario';

const scenario: DebateScenario = {
  name: 'judge-flow',
  unsupported:
    'The debate engine currently exposes no judge participant, ballot, or adjudication operation. Add a domain operation before encoding a judge-flow scenario.',
  given: {
    clock: '2026-01-01T00:00:00.000Z',
    ids: ['11111111-1111-4111-8111-111111111111'],
    resolution: 'A representative resolution',
  },
  when: [],
  expect: {
    id: '11111111-1111-4111-8111-111111111111',
    createdAt: '2026-01-01T00:00:00.000Z',
    phase: 'waiting',
    participantIds: [],
  },
};

export default scenario;
