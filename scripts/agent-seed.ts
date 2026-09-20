export const agentSeedVersion = 'agent-seed-v1';

export const agentSeedUsers = [
  {
    userId: 'k2v9x0f4m8q3w1z7c5n6b4d2',
    username: 'agent-alice',
  },
  {
    userId: 'a7b3c9d1e5f2k4m6n8p1r3t5',
    username: 'agent-bob',
  },
] as const;

export const agentSeedDebate = {
  debateId: 'c8d4e2f6a1b3k5m7n9p2r4t6',
  createdBy: agentSeedUsers[0].userId,
  resolution:
    'Resolved: a deterministic local seed makes agent development repeatable.',
  format: 'oxford',
  snapshot: {
    phase: 'waiting',
    participants: [],
  },
} as const;
