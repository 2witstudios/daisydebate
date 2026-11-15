import { z } from 'zod';
import { idSchema } from './primitives';
import { tournamentHostingGrantSchema } from './tournament-hosting';
import type { RoomExecutionPlan } from './room';
import type { RoundRules } from './format';

const scope = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('organization'), organizationId: idSchema }),
  z.strictObject({ kind: z.literal('lobby'), lobbyId: idSchema }),
]);
export const tournamentOfficialAuthoritySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('owner'), scope }),
  z.strictObject({
    kind: z.literal('grant'),
    grantId: idSchema,
    revision: z.number().int().positive(),
    scope,
  }),
]);
/** Immutable admission is an economic/capacity obligation, never a media-read entitlement. */
export const tournamentCaptureAdmissionSchema = z
  .strictObject({
    id: idSchema,
    roundId: idSchema,
    roomId: idSchema,
    lobbyId: idSchema,
    eventId: idSchema,
    fixtureId: idSchema,
    commandId: idSchema,
    funding: z.discriminatedUnion('kind', [
      z.strictObject({
        kind: z.literal('personal-owner'),
        ownerUserId: idSchema,
      }),
      z.strictObject({
        kind: z.literal('organization-sponsor'),
        organizationId: idSchema,
        sponsorshipVersionId: idSchema,
      }),
    ]),
    grant: tournamentHostingGrantSchema,
    official: z.strictObject({
      userId: idSchema,
      actorId: idSchema,
      authority: tournamentOfficialAuthoritySchema,
    }),
    admittedAt: z.iso.datetime(),
    deadlineAt: z.iso.datetime(),
    executionBudgetMs: z.number().int().positive(),
    capacity: z.strictObject({
      kind: z.literal('nonranked-egress'),
      fleetLimit: z.literal(1),
      sponsorLimit: z.number().int().positive(),
      tournamentLimit: z.number().int().positive(),
    }),
  })
  .refine((value) => {
    const admitted = Date.parse(value.admittedAt),
      deadline = Date.parse(value.deadlineAt);
    return (
      Date.parse(value.grant.hosting.startsAt) <= admitted &&
      admitted < deadline &&
      deadline <= Date.parse(value.grant.hosting.expiresAt) &&
      deadline <= admitted + value.executionBudgetMs &&
      value.grant.hosting.coverage.tournamentIds.includes(value.lobbyId) &&
      value.capacity.sponsorLimit ===
        value.grant.hosting.coverage.sponsorConcurrencyLimit &&
      value.capacity.tournamentLimit ===
        value.grant.hosting.coverage.tournamentConcurrencyLimit &&
      (value.funding.kind !== 'personal-owner' ||
        value.funding.ownerUserId === value.grant.hosting.userId)
    );
  });
export type TournamentCaptureAdmission = z.infer<
  typeof tournamentCaptureAdmissionSchema
>;
export type TournamentOfficialAuthority = z.infer<
  typeof tournamentOfficialAuthoritySchema
>;

/** The frozen execution budget bounds capture even when a runtime pauses or never ends. */
export const tournamentCaptureExecutionBudgetMs = (
  rules: RoundRules,
  plan: RoomExecutionPlan,
): number =>
  rules.segments.reduce(
    (total, segment) => total + segment.durationMs + rules.countdownMs,
    0,
  ) +
  (rules.inRoundPrep?.budgetMsPerSide ?? 0) * rules.sides.length +
  (plan.preRoundPrep.enabled ? plan.preRoundPrep.durationMs : 0) +
  (plan.resolutionDraw.enabled
    ? (plan.resolutionDraw.drawSize - 1) * plan.resolutionDraw.strikeWindowMs
    : 0);
