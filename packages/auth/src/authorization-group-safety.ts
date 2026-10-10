import { idSchema } from '@daisy/protocol';
import type {
  AuthorizationCapability,
  ChannelAuthorizationFact,
} from './authorization-facts';
/** Revocation never admits members or grants content access. MSG owns target and manager invariants. */
export function groupSafetyAllowed(
  actorId: string,
  capability: AuthorizationCapability,
  channel: ChannelAuthorizationFact,
): boolean {
  const grant = channel.authority;
  if (grant.kind !== 'private_group') return false;
  const ids = [channel.channelId, grant.actorId, ...grant.activeMemberActorIds];
  const lifecycleAllowed =
    capability === 'channel.group.archive'
      ? channel.lifecycle === 'active'
      : ['active', 'archived'].includes(channel.lifecycle);
  return (
    lifecycleAllowed &&
    channel.policyKey === 'social.private_group' &&
    ids.every((id) => idSchema.safeParse(id).success) &&
    grant.actorId === actorId &&
    grant.role === 'manager' &&
    grant.activeMemberActorIds.includes(actorId)
  );
}
