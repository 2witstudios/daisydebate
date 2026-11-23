import type { RoundRecord } from './round-view';

/** Who owns the Room a Round was played in, as its reader found it under the account fence. */
export type RoundOutcomeOwner =
  | { readonly kind: 'ordinary' }
  | { readonly kind: 'event'; readonly direction: unknown }
  | { readonly kind: 'unavailable' };

/** A completed event Round is not itself a release of its decision. */
export const roundOutcomeForAudience = <T extends RoundRecord>(
  view: T,
  owner: RoundOutcomeOwner,
  decisionVisible: boolean,
): T =>
  owner.kind === 'ordinary' ||
  (owner.kind === 'event' && owner.direction !== null && decisionVisible)
    ? view
    : { ...view, outcome: null, panelRuling: null };
