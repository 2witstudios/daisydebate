import { practiceRoomConfig } from './reference-formats';
import { validRules } from './testing';

export const caller = {
  userId: 'c8d4e2f6a1b3k5m7n9p2r4t6',
  actorId: 'c5a1b3d7e9f2h4j6k8m1n3p5',
};
export const accountFact = (
  actorId: string | null = caller.actorId,
  userId = caller.userId,
  revision = 3,
) => ({ userId, actorId, member: true, erased: false, revision });
export const room = {
  id: 'c7a5d3f1h9j2k4m6n8p1r3t5',
  hostActorId: caller.actorId,
  title: 'Proof room',
  topic: 'A motion',
  visibility: 'public' as const,
  formatId: 'c9a7d5f3h1j2k4m6n8p1r3t5',
  formatVersion: 1,
  presetVersion: null,
  competitionType: 'casual' as const,
  length: 'full' as const,
  config: practiceRoomConfig,
  executionPlan: { preRoundPrep: { enabled: false as const } },
  rules: validRules,
};
