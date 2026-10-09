import type { ContactAuthorizationFact } from './authorization-facts';
/** MSG is the sole pair producer; the shared evaluator validates its projection. */
export function contactPairValid(pair: ContactAuthorizationFact): boolean {
  return (
    typeof pair.blocked === 'boolean' &&
    pair.lowActorId < pair.highActorId &&
    Number.isSafeInteger(pair.revision) &&
    pair.revision > 0
  );
}
