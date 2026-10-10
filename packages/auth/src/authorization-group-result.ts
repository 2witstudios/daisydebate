import { idSchema } from '@daisy/protocol';
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
  if (!fact.channel || !fact.command) return false;
  const { channel, command } = fact;
  const ids = [
    channel.channelId,
    command.actorId,
    command.requestId,
    command.resultChannelId,
  ];
  return (
    ids.every((id) => idSchema.safeParse(id).success) &&
    [channel.revision, channel.policyRevision].every(positive) &&
    channel.kind === 'private_group' &&
    channel.policyKey === 'social.private_group' &&
    ['active', 'archived'].includes(channel.lifecycle) &&
    command.actorId === actorId &&
    command.resultChannelId === channel.channelId &&
    completedKinds.includes(command.kind)
  );
}
