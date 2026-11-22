import { idSchema } from '@daisy/protocol/primitives';
import { messagingPrivateGroupPolicySchema } from '@daisy/protocol/messaging/social';
import type { GroupCommandResultAuthorizationFact } from './authorization-facts';
const positive = (value: number) => Number.isSafeInteger(value) && value > 0;
const completedKinds = [
  'group.invite',
  'group.remove',
  'group.leave',
  'group.transfer',
  'group.archive',
];
/** A durable receipt is not a grant. Erasure removes its association at the producer. */
export function groupCommandResultAllowed(
  actorId: string,
  fact: GroupCommandResultAuthorizationFact,
): boolean {
  const { channel, command } = fact;
  if (!messagingPrivateGroupPolicySchema.safeParse(channel).success)
    return false;
  const ids = [
    channel.channelId,
    command.actorId,
    command.requestId,
    command.resultChannelId,
  ];
  return (
    ids.every((id) => idSchema.safeParse(id).success) &&
    [channel.revision, channel.policyRevision].every(positive) &&
    ['active', 'archived'].includes(channel.lifecycle) &&
    command.actorId === actorId &&
    command.resultChannelId === channel.channelId &&
    completedKinds.includes(command.kind)
  );
}
