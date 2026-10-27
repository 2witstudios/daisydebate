import type { AuthorizationCapability } from '@daisy/protocol/authorization';
import type { AuthorizationInput } from './authorization-facts';

/** Whether a resource is the kind a capability addresses. */
export function validResourceKind(
  capability: AuthorizationCapability,
  resource: AuthorizationInput['resource'],
) {
  const specialized = {
    'channel.group.result': 'group_command_result',
    'channel.group.invite': 'group_invitation_creation',
    'channel.reaction.remove': 'channel_reaction',
    'channel.preferences.clear': 'channel_preference',
    'channel.inbox.read': 'messaging_collection',
    'social.friend.list': 'messaging_collection',
    'member.history.read': 'member_history',
    'channel.file.cleanup': 'pending_file',
    'account.collection.read': 'account_collection',
    'account.beta_access.update': 'account',
  } as const;
  const kind = specialized[capability as keyof typeof specialized];
  if (kind) return resource.kind === kind;
  if (capability.startsWith('channel.invitation.'))
    return resource.kind === 'group_invitation';
  if (capability === 'social.block' || capability.startsWith('social.friend.'))
    return resource.kind === 'contact_pair';
  if (
    ['social.request.create', 'channel.create.private_group'].includes(
      capability,
    )
  )
    return resource.kind === 'social_creation';
  if (capability.startsWith('foundation.'))
    return resource.kind === 'foundation';
  if (capability === 'round.read') return resource.kind === 'round';
  if (['room.create', 'room.list'].includes(capability))
    return resource.kind === 'room_collection';
  return (
    resource.kind === (capability.startsWith('room.') ? 'room' : 'channel')
  );
}
