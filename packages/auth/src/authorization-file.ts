import { idSchema } from '@daisy/protocol';
import type { PendingFileAuthorizationFact } from './authorization-facts';
const positive = (value: number) => Number.isSafeInteger(value) && value > 0;
/** Cleanup changes only the caller's still-pending generation; it grants no file/content read. */
export function pendingFileCleanupAllowed(
  actorId: string,
  fact: PendingFileAuthorizationFact,
): boolean {
  if (!fact.channel) return false;
  const ids = [
    fact.fileId,
    fact.channelId,
    fact.ownerActorId,
    fact.channel.channelId,
  ];
  const revisions = [
    fact.generation,
    fact.expectedGeneration,
    fact.revision,
    fact.channel.revision,
    fact.channel.policyRevision,
  ];
  const keys = { dm: 'social.dm', private_group: 'social.private_group' };
  const expectedPolicy = keys[fact.channel.kind];
  return (
    ids.every((id) => idSchema.safeParse(id).success) &&
    revisions.every(positive) &&
    fact.ownerActorId === actorId &&
    fact.channelId === fact.channel.channelId &&
    fact.generation === fact.expectedGeneration &&
    ['reserved', 'quarantined'].includes(fact.lifecycle) &&
    typeof expectedPolicy === 'string' &&
    expectedPolicy === fact.channel.policyKey
  );
}
