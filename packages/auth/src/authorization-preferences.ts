import { idSchema } from '@daisy/protocol';
import type { MessagingPreferenceAuthorizationFact } from './authorization-facts';
/** Clear deletes an existing own row only. No content, upsert or channel grant is conveyed. */
export function preferenceClearAllowed(
  actorId: string,
  fact: MessagingPreferenceAuthorizationFact,
): boolean {
  return (
    fact.actorId === actorId &&
    [fact.actorId, fact.channelId].every((id) => idSchema.safeParse(id).success)
  );
}
