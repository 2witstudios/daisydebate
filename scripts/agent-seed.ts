import { resolveRoomConfiguration } from '@daisy/debate-engine';
import { foundationDefinition, referenceFormats } from './reference-formats';

export const agentSeedVersion = 'agent-seed-v5';

/**
 * One actor per agent user (ADR 0029): competitive rows reference the actor,
 * never the Better Auth user. IDs are fixed cuid2-shaped values so reseeding
 * is byte-identical.
 */
export const agentSeedUsers = [
  {
    userId: 'k2v9x0f4m8q3w1z7c5n6b4d2',
    actorId: 'h3j7m1p5r9t2v6x0z4b8d2f6',
    username: 'agent-alice',
  },
  {
    userId: 'a7b3c9d1e5f2k4m6n8p1r3t5',
    actorId: 'q5s9u3w7y1a4c8e2g6j0l4n8',
    username: 'agent-bob',
  },
] as const;

const agentSeedRoundId = 'c8d4e2f6a1b3k5m7n9p2r4t6';
const agentSeedResolution =
  'Resolved: a deterministic local seed makes agent development repeatable.';

/**
 * The seeded round resolves the same way a room does — one compiler, the
 * foundation definition against the practice config — so the seed's frozen
 * rules are exactly what a casual round of this format would carry. Seats
 * are the two agent actors on the sides. Bump `agentSeedVersion` whenever
 * this content changes.
 */
const resolved = resolveRoomConfiguration(foundationDefinition, {
  preRoundPrep: { enabled: false },
  inRoundPrep: { enabled: true, budgetMsPerSide: 120_000 },
  speechTiming: { countdownMs: 10_000, segmentDurationOverrides: {} },
  crossExamination: { crossExMode: 'ordered' },
  interruptions: null,
  yielding: null,
});
if (!resolved.ok)
  throw new Error(`Seed round refuses to resolve: ${resolved.refusal.message}`);

export const agentSeedRound = {
  id: agentSeedRoundId,
  createdByActorId: agentSeedUsers[0].actorId,
  resolution: agentSeedResolution,
  formatId: 'foundation',
  formatVersion: 1,
  rules: resolved.rules,
  seats: [
    {
      id: 'f1a2b3c4d5e6a7b8c9d0e1f2',
      actorId: agentSeedUsers[0].actorId,
      role: 'affirmative' as const,
      slot: 0,
    },
    {
      id: 'a1b2c3d4e5f6a7b8c9d0e1f3',
      actorId: agentSeedUsers[1].actorId,
      role: 'negative' as const,
      slot: 0,
    },
  ],
} as const;

// The reference formats stay importable for tooling that lists them.
export const seedFormatIds = referenceFormats.map((format) => format.id);
