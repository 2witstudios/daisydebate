export const agentSeedVersion = 'agent-seed-v2';

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

const agentSeedDebateId = 'c8d4e2f6a1b3k5m7n9p2r4t6';
const agentSeedResolution =
  'Resolved: a deterministic local seed makes agent development repeatable.';
// Fixed so reseeding is byte-identical; the seed never reads a clock.
const agentSeedCreatedAt = '2026-01-01T00:00:00.000Z';

/**
 * The snapshot must satisfy the protocol `debateSnapshotSchema`, and the
 * searchable columns must repeat the snapshot's id, resolution, and format.
 * Bump `agentSeedVersion` whenever this content changes.
 */
export const agentSeedDebate = {
  debateId: agentSeedDebateId,
  createdBy: agentSeedUsers[0].userId,
  resolution: agentSeedResolution,
  format: 'foundation',
  snapshot: {
    version: 1,
    id: agentSeedDebateId,
    resolution: agentSeedResolution,
    format: 'foundation',
    phase: 'waiting',
    createdAt: agentSeedCreatedAt,
    participants: [],
  },
} as const;
