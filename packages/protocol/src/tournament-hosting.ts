import { isInstantAtOrBefore, isInstantBefore } from '@daisy/clock/instant';
import { z } from 'zod';
import { idSchema } from './primitives';
import { subscriptionEvidenceSchema } from './billing';

/** Named, finite tournament coverage; it never implies a Premium or media-read grant. */
export const tournamentHostingCoverageSchema = z.strictObject({
  tournamentIds: z
    .array(idSchema)
    .refine((ids) => new Set(ids).size === ids.length),
  sponsorConcurrencyLimit: z.number().int().positive(),
  tournamentConcurrencyLimit: z.number().int().positive(),
});

const tournamentHostingIssuerSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('administrative'),
    decisionReference: z.string().trim().min(1).max(500),
    serviceId: z.string().trim().min(1).max(80),
    operatorRef: idSchema,
  }),
  z.strictObject({
    kind: z.literal('subscription'),
    subscriptionId: idSchema,
    observedAt: z.iso.datetime(),
    evidence: subscriptionEvidenceSchema,
  }),
]);

/** The selected immutable canonical grant version, frozen into capture admission. */
const tournamentHostingVersionSchema = z
  .strictObject({
    id: idSchema,
    userId: idSchema,
    version: z.number().int().positive(),
    startsAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    issuer: tournamentHostingIssuerSchema,
    coverage: tournamentHostingCoverageSchema,
  })
  .refine((value) => {
    if (!isInstantBefore(value.startsAt, value.expiresAt)) return false;
    if (value.issuer.kind === 'administrative') return true;
    const { settlement } = value.issuer.evidence;
    return (
      settlement.kind === 'paid' &&
      settlement.period.subscriptionId === value.issuer.subscriptionId &&
      isInstantAtOrBefore(settlement.period.startsAt, value.startsAt) &&
      isInstantAtOrBefore(value.expiresAt, settlement.period.endsAt)
    );
  });

export const tournamentHostingGrantSchema = z
  .strictObject({
    entitlement: z.literal('tournament_hosting'),
    source: z.enum(['administrative', 'subscription']),
    hosting: tournamentHostingVersionSchema,
  })
  .refine((value) => value.source === value.hosting.issuer.kind);
export type TournamentHostingGrant = z.infer<
  typeof tournamentHostingGrantSchema
>;
