import { idSchema } from '@daisy/protocol';
import type {
  AuthorizationCapability,
  ChannelAuthorizationFact,
} from './authorization-facts';
const positive = (value: number) => Number.isSafeInteger(value) && value > 0;
/** Shared live manager projection; admission is evaluated separately. */
export function groupManagerCurrent(
  actorId: string,
  channel: ChannelAuthorizationFact,
): boolean {
  const grant = channel.authority;
  if (grant.kind !== 'private_group') return false;
  const ids = [channel.channelId, grant.actorId, ...grant.activeMemberActorIds];
  return (
    channel.policyKey === 'social.private_group' &&
    [channel.revision, channel.policyRevision, grant.generation].every(
      positive,
    ) &&
    ids.every((id) => idSchema.safeParse(id).success) &&
    new Set(grant.activeMemberActorIds).size ===
      grant.activeMemberActorIds.length &&
    grant.actorId === actorId &&
    grant.role === 'manager' &&
    grant.activeMemberActorIds.includes(actorId)
  );
}
/** Revocation never admits members or grants content access. MSG owns target and manager invariants. */
export function groupSafetyAllowed(
  actorId: string,
  capability: AuthorizationCapability,
  channel: ChannelAuthorizationFact,
): boolean {
  const lifecycleAllowed =
    capability === 'channel.group.archive'
      ? channel.lifecycle === 'active'
      : ['active', 'archived'].includes(channel.lifecycle);
  return lifecycleAllowed && groupManagerCurrent(actorId, channel);
}
