import type { PhotoCheckVerdict } from '@daisy/protocol/public-profile';

/** What the check's answer means for a new photo. */
export type CheckDecision =
  | { readonly kind: 'publish' }
  | { readonly kind: 'review' }
  | { readonly kind: 'refuse' };

/**
 * Fail closed: only an `allow` publishes. An unsure check, no configured check
 * (null), or a check that failed (also null) goes to an operator. A `block`
 * is refused and its image never stored.
 */
export function checkDecision(verdict: PhotoCheckVerdict | null): CheckDecision {
  switch (verdict) {
    case 'allow':
      return { kind: 'publish' };
    case 'block':
      return { kind: 'refuse' };
    case 'review':
    case null:
      return { kind: 'review' };
  }
}
