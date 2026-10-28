import { oneOnOneSettings } from './reference-formats';
import { validRules } from './testing-rules';

export const caller = {
  userId: 'c8d4e2f6a1b3k5m7n9p2r4t6',
  actorId: 'c5a1b3d7e9f2h4j6k8m1n3p5',
};
export const accountFact = (
  actorId: string | null = caller.actorId,
  userId = caller.userId,
  revision = 3,
) => ({
  userId,
  actorId,
  member: true,
  erased: false,
  revision,
  beta: { state: 'approved' as const, revision: 1 },
  ageBand: 'adult' as const,
});
/** The canonical account function's raw row behind `accountFact`. */
export const accountRow = (
  actorId: string | null = caller.actorId,
  userId = caller.userId,
  revision = 3,
) => ({
  userId,
  actorId,
  member: true,
  erased: false,
  revision,
  betaState: 'approved',
  betaRevision: 1,
  ageBand: 'adult',
});
/** The checked fact a canonical account row validates to. */
export const factOfRow = <
  Row extends { betaState: string | null; betaRevision: number | null },
>({
  betaState,
  betaRevision,
  ...rest
}: Row) => ({
  ...rest,
  beta:
    betaState === null ? null : { state: betaState, revision: betaRevision },
});
export const room = {
  id: 'c7a5d3f1h9j2k4m6n8p1r3t5',
  hostActorId: caller.actorId,
  title: 'Proof room',
  topic: 'A motion',
  visibility: 'public' as const,
  formatId: 'c9a7d5f3h1j2k4m6n8p1r3t5',
  formatVersion: 1,
  presetVersion: null,
  basis: null,
  competitionType: 'casual' as const,
  config: oneOnOneSettings,
  executionPlan: {
    preRoundPrep: { enabled: false as const },
    resolutionDraw: { enabled: false as const },
  },
  rules: validRules,
};
