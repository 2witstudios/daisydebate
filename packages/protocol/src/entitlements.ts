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

export const entitlementSources = ['beta', 'subscription'] as const;

export type EntitlementGrant = {
  readonly entitlement: EntitlementKind;
} & (
  | { readonly source: 'beta' }
  | {
      readonly source: 'subscription';
      /** Half-open validity, enforced on reads even when workers stop. */
      readonly startsAt: string;
      readonly expiresAt: string;
    }
);
