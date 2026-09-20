export const agentSeedVersion = 'agent-seed-v1';

export const agentSeedUsers = [
  {
    userId: '00000000-0000-4000-8000-000000000001',
    username: 'agent-alice',
  },
  {
    userId: '00000000-0000-4000-8000-000000000002',
    username: 'agent-bob',
  },
] as const;

export const agentSeedDebate = {
  debateId: '00000000-0000-4000-8000-000000000101',
  createdBy: agentSeedUsers[0].userId,
  resolution:
    'Resolved: a deterministic local seed makes agent development repeatable.',
  format: 'oxford',
  snapshot: {
    phase: 'waiting',
    participants: [],
  },
} as const;
