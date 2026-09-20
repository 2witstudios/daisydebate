import type { DebateScenario } from '../scripts/scenario';

const scenario: DebateScenario = {
  name: 'ready-up',
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
  ],
  expect: {
    id: '11111111-1111-4111-8111-111111111111',
    createdAt: '2026-01-01T00:00:00.000Z',
    phase: 'waiting',
    participantIds: [
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
    ],
  },
};

export default scenario;
