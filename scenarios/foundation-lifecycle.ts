import type { DebateScenario } from '../scripts/scenario';

const scenario: DebateScenario = {
  name: 'foundation-lifecycle',
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
    id: 'k2v9x0f4m8q3w1z7c5n6b4d2',
    createdAt: '2026-01-01T00:00:00.000Z',
    phase: 'completed',
    participantIds: ['a7b3c9d1e5f2k4m6n8p1r3t5', 'c8d4e2f6a1b3k5m7n9p2r4t6'],
  },
};

export default scenario;
