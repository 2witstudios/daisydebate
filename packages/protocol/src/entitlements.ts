import { z } from 'zod';
import { idSchema } from './primitives';
import { tournamentHostingGrantSchema } from './tournament-hosting';

/**
 * Named premium entitlement grants (DEC-247, ISSUE-779): what an account is
 * granted, and where the grant came from. A grant is its own fact; beta
 * access is a source that writes one, never the entitlement itself.
 */
export const entitlementKinds = [
  'round_analysis',
  'ai_rounds',
  /** Seating an AI judge on a casual Round (WATCH-16); ranked needs no grant. */
  'casual_ai_judge',
  /** A casual host's broadcast and recording opt-ins (WATCH-8); ranked needs no grant. */
  'casual_capture',
  /** Downloading a Recording: its own concept, not a host's capture opt-in. */
  'recording_download',
] as const;
type EntitlementKind = (typeof entitlementKinds)[number];

export const entitlementSources = [
  'beta',
  'subscription',
  'administrative',
  /** A club pays for this member's seat (ADR 0148). */
  'organization_seat',
] as const;

/** Ordinary Premium remains exactly these five capabilities. Hosting is independently issued. */
export const accountEntitlementKinds = [
  ...entitlementKinds,
  'tournament_hosting',
] as const;

export const entitlementGrantSchema = z.union([
  z.object({
    entitlement: z.enum(entitlementKinds),
    source: z.literal('beta'),
  }),
  z.object({
    entitlement: z.enum(entitlementKinds),
    source: z.literal('subscription'),
    startsAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  }),
  z.object({
    entitlement: z.enum(entitlementKinds),
    source: z.literal('organization_seat'),
    /** The club paying for the seat. */
    organizationId: idSchema,
    startsAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  }),
  tournamentHostingGrantSchema,
]);

export type EntitlementGrant = z.infer<typeof entitlementGrantSchema>;
export type PremiumEntitlementKind = EntitlementKind;
