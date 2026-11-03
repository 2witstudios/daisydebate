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
    'social.friend.list': 'friend_collection',
    'social.challenge.list': 'challenge_collection',
    'social.people.list': 'people_list',
    'social.rating_visibility.read': 'rating_visibility',
    'social.rating_visibility.update': 'rating_visibility',
    'social.moderation_notice.read': 'moderation_notice',
    'social.moderation_notice.acknowledge': 'moderation_notice',
    'social.presence.read': 'presence_setting',
    'social.presence.update': 'presence_setting',
    'channel.retained.read': 'messaging_collection',
    'channel.retained.delete': 'messaging_collection',
    'member.history.read': 'member_history',
    'channel.file.cleanup': 'pending_file',
    'account.collection.read': 'account_collection',
    'account.beta_access.update': 'account',
    'content_report.queue.read': 'content_moderation',
    'content_report.resolve': 'content_moderation',
    'broadcast.stop': 'content_moderation',
    'broadcast.chat_slow_mode.update': 'content_moderation',
    'recording.takedown': 'content_moderation',
    'recording.restore': 'content_moderation',
    'recording.remove': 'content_moderation',
    'chat_message.remove': 'content_moderation',
    'account.audience_ban.update': 'content_moderation',
    'report.collection.read': 'account_collection',
    'report.resolve': 'account_collection',
    'moderation.collection.read': 'account_collection',
    'moderation.lift': 'account_collection',
  } as const;
  const kind = specialized[capability as keyof typeof specialized];
  if (kind) return resource.kind === kind;
  if (capability.startsWith('channel.invitation.'))
    return resource.kind === 'group_invitation';
  if (
    capability === 'social.block' ||
    capability === 'social.report' ||
    capability.startsWith('social.friend.') ||
    capability.startsWith('social.challenge.')
  )
    return resource.kind === 'contact_pair';
  if (
    ['channel.dm.request', 'channel.create.private_group'].includes(capability)
  )
    return resource.kind === 'social_creation';
  if (capability.startsWith('foundation.'))
    return resource.kind === 'foundation';
  if (capability.startsWith('round.')) return resource.kind === 'round';
  if (['room.create', 'room.list'].includes(capability))
    return resource.kind === 'room_collection';
  return (
    resource.kind === (capability.startsWith('room.') ? 'room' : 'channel')
  );
}
