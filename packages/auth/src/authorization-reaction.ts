import { idSchema } from '@daisy/protocol';
import type { MessagingReactionAuthorizationFact } from './authorization-facts';
/** This proof is loaded from a locked row, never constructed from a removal intent. */
export function reactionAssociationOwned(
  actorId: string,
  fact: MessagingReactionAuthorizationFact,
) {
  const row = fact.reaction;
  return (
    row.actorId === actorId &&
    row.channelId === fact.channel.channelId &&
    idSchema.safeParse(row.messageId).success &&
    typeof row.reaction === 'string' &&
    row.reaction.length > 0 &&
    row.reaction.trim() === row.reaction
  );
}
