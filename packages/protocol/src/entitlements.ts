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
] as const;
type EntitlementKind = (typeof entitlementKinds)[number];

/** Today beta approval is the only source; billing adds its own later. */
export const entitlementSources = ['beta'] as const;
type EntitlementSource = (typeof entitlementSources)[number];

export type EntitlementGrant = {
  readonly entitlement: EntitlementKind;
  readonly source: EntitlementSource;
};
