import { z } from 'zod';
import {
  permissionSchema,
  type AuthorizationCapability,
} from './authorization';

/** Every kind of resource a capability may be asked of. */
export const authorizationResourceKindSchema = z.enum([
  'channel_reaction',
  'channel_preference',
  'group_invitation_creation',
  'group_command_result',
  'group_invitation',
  'messaging_collection',
  'friend_collection',
  'challenge_collection',
  'people_list',
  'rating_visibility',
  'moderation_notice',
  'presence_setting',
  'member_history',
  'pending_file',
  'contact_pair',
  'social_creation',
  'round',
  'room',
  'channel',
  'room_collection',
  'account_collection',
  'flag_control',
  'account',
  'content_moderation',
  'foundation',
  'organization_collection',
  'organization',
  'membership',
  'guardian_link',
  'lobby_collection',
  'lobby',
  'template',
  'entry',
  'judge',
  'tab_round',
  'draw',
  'fixture',
  'ballot',
  'pending_command',
  'sanction',
]);
export type AuthorizationResourceKind = z.infer<
  typeof authorizationResourceKindSchema
>;

export const lobbyKindSchema = z.enum(['standing', 'tournament']);
export type LobbyKind = z.infer<typeof lobbyKindSchema>;
export const organizationKindSchema = z.enum(['league', 'school']);
export type OrganizationKind = z.infer<typeof organizationKindSchema>;

/**
 * How far a capability reaches for a minor whose guardian limits their
 * lobbies: into a lobby, to another person, or neither.
 */
export type CapabilityReach = 'lobby' | 'person' | null;

export type CapabilityMetadata = {
  /** The resource kinds the capability may be asked of. */
  readonly resourceKinds: readonly AuthorizationResourceKind[];
  /** The one lobby kind it means something in; null for either or none. */
  readonly lobbyKind: LobbyKind | null;
  /** The one organization kind it means something in; null for either. */
  readonly organizationKind: OrganizationKind | null;
  /** A denied read answers as a missing resource. */
  readonly read: boolean;
  /** A permission: a role may hold it. */
  readonly grantable: boolean;
  /** A connection to the fixture changes the answer. */
  readonly conflictSensitive: boolean;
  readonly reach: CapabilityReach;
};

type Row = Omit<CapabilityMetadata, 'grantable'>;
/**
 * One row. The resource kinds and the reach are always written, so a new
 * capability cannot escape a minor's boundary by omission.
 */
const on = (
  resourceKinds: readonly AuthorizationResourceKind[],
  reach: CapabilityReach,
  flags: Partial<Omit<Row, 'resourceKinds' | 'reach'>> = {},
): Row => ({
  resourceKinds,
  reach,
  lobbyKind: null,
  organizationKind: null,
  read: false,
  conflictSensitive: false,
  ...flags,
});
const read = { read: true } as const;
const tournament = { lobbyKind: 'tournament' } as const;
const tournamentRead = { ...tournament, ...read } as const;
const conflicted = { conflictSensitive: true } as const;
const school = { organizationKind: 'school' } as const;
const operatorModeration = on(['content_moderation'], null);

const rows: Record<AuthorizationCapability, Row> = {
  'social.block': on(['contact_pair'], null),
  'social.friend.request': on(['contact_pair'], 'person'),
  'social.friend.end': on(['contact_pair'], null),
  'social.friend.list': on(['friend_collection'], null, read),
  'social.challenge.send': on(['contact_pair'], 'person'),
  'social.challenge.accept': on(['contact_pair'], 'person'),
  'social.challenge.decline': on(['contact_pair'], null),
  'social.challenge.cancel': on(['contact_pair'], null),
  'social.challenge.list': on(['challenge_collection'], null, read),
  'social.people.list': on(['people_list'], null, read),
  'social.report': on(['contact_pair'], null),
  'social.rating_visibility.read': on(['rating_visibility'], null, read),
  'social.rating_visibility.update': on(['rating_visibility'], null),
  'social.moderation_notice.read': on(['moderation_notice'], null, read),
  'social.moderation_notice.acknowledge': on(['moderation_notice'], null),
  'social.presence.read': on(['presence_setting'], null, read),
  'social.presence.update': on(['presence_setting'], null),
  'channel.retained.read': on(['messaging_collection'], null, read),
  'channel.retained.delete': on(['messaging_collection'], null),
  'channel.dm.request': on(['social_creation'], 'person'),
  'channel.create.private_group': on(['social_creation'], 'person'),
  'foundation.create': on(['foundation'], null),
  'foundation.read': on(['foundation'], null, read),
  'round.read': on(['round'], 'lobby', read),
  'round.observe.undelayed': on(['round'], null, { ...read, ...conflicted }),
  'round.transcript.read': on(['round'], null, read),
  'round.analysis.read': on(['round'], null, read),
  'round.analysis.request': on(['round'], null),
  'member.history.read': on(['member_history'], 'person', read),
  'room.create': on(['room_collection'], null),
  'room.list': on(['room_collection', 'lobby'], 'lobby', read),
  'room.read': on(['room'], 'lobby', read),
  'room.join': on(['room'], 'lobby'),
  'room.manage': on(['room'], null, conflicted),
  'room.ready': on(['room'], null),
  'room.leave': on(['room'], null),
  'channel.inbox.read': on(['messaging_collection'], null, read),
  'channel.read': on(['channel'], null, read),
  'channel.preferences.read': on(['channel'], null, read),
  'channel.preferences.update': on(['channel'], null),
  'channel.preferences.clear': on(['channel_preference'], null),
  'channel.post': on(['channel'], null),
  'channel.message.remove': on(['channel'], null),
  'channel.reaction.remove': on(['channel_reaction'], null),
  'channel.file.cleanup': on(['pending_file'], null),
  'channel.manage': on(['channel'], null),
  'channel.leave': on(['channel'], null),
  'channel.group.result': on(['group_command_result'], null, read),
  'channel.group.revoke': on(['channel'], null),
  'channel.group.archive': on(['channel'], null),
  'channel.group.invite': on(['group_invitation_creation'], 'person'),
  'channel.invitation.read': on(['group_invitation'], null, read),
  'channel.invitation.accept': on(['group_invitation'], 'person'),
  'channel.invitation.decline': on(['group_invitation'], null),
  'channel.invitation.cancel': on(['group_invitation'], null),
  'channel.invitation.result': on(['group_invitation'], null, read),
  'channel.subscribe': on(['channel'], null, read),
  'channel.request.status': on(['channel'], null, read),
  'channel.request.read': on(['channel'], null, read),
  'channel.request.result': on(['channel'], null, read),
  'channel.request.decide': on(['channel'], 'person'),
  'channel.request.cancel': on(['channel'], null),
  'beta.preapproval.read': on(['account_collection'], null, read),
  'beta.preapproval.update': on(['account_collection'], null),
  'account.collection.read': on(['account_collection'], null, read),
  'flag.state.update': on(['flag_control'], null),
  'flag.override.update': on(['flag_control'], null),
  'flag.command.read': on(['flag_control'], null, read),
  'account.beta_access.update': on(['account'], null),
  'content_report.queue.read': on(['content_moderation'], null, read),
  'content_report.resolve': operatorModeration,
  'broadcast.stop': operatorModeration,
  'broadcast.chat_slow_mode.update': operatorModeration,
  'recording.takedown': operatorModeration,
  'recording.restore': operatorModeration,
  'recording.remove': operatorModeration,
  'recording.legal_remove': operatorModeration,
  'recording.rebuild': operatorModeration,
  'recording.rebuildable.read': on(['content_moderation'], null, read),
  'chat_message.remove': operatorModeration,
  'account.audience_ban.update': operatorModeration,
  'report.collection.read': on(['account_collection'], null, read),
  'report.resolve': on(['account_collection'], null),
  'moderation.collection.read': on(['account_collection'], null, read),
  'moderation.lift': on(['account_collection'], null),

  'organization.manage': on(['organization', 'template'], null),
  'organization.roles.manage': on(['organization', 'lobby'], null),
  'lobby.setup.manage': on(['organization', 'lobby'], null),
  'lobby.announce': on(['lobby'], null),
  'action_history.read': on(['organization', 'lobby'], null, read),
  'tournament.entries.manage': on(['lobby'], null, tournament),
  'tournament.draw.edit': on(['tab_round', 'draw', 'fixture'], null, {
    ...tournament,
    ...conflicted,
  }),
  'tournament.draw.publish': on(['draw'], null, tournament),
  'tournament.rooms.officiate': on(['fixture'], null, {
    ...tournament,
    ...conflicted,
  }),
  'tournament.results.enter': on(['fixture'], null, {
    ...tournament,
    ...conflicted,
  }),
  'tournament.results.release': on(['lobby', 'tab_round'], null, tournament),
  'tournament.ballots.read_unreleased': on(['fixture', 'ballot'], null, {
    ...tournamentRead,
    ...conflicted,
  }),
  'tournament.resolutions.read_unreleased': on(
    ['tab_round'],
    null,
    tournamentRead,
  ),
  'school.roster.manage': on(['organization'], null, school),
  'school.ballots.read': on(['organization'], null, { ...school, ...read }),

  'organization.create': on(['organization_collection'], null),
  'organization.read': on(['organization'], null, read),
  'organization.host.read': on(['organization'], null, read),
  'organization.membership.respond': on(['membership'], null),
  'organization.membership.leave': on(['membership'], null),
  'organization.owner.transfer': on(['organization'], null),
  'guardian.link.create': on(['guardian_link'], null),
  'guardian.link.manage': on(['guardian_link'], null),
  'guardian.link.read': on(['guardian_link'], null, read),
  'lobby.create': on(['lobby_collection'], null),
  'lobby.read': on(['lobby'], 'lobby', read),
  'lobby.host.read': on(['lobby'], null, read),
  'lobby.room.create': on(['lobby'], 'lobby', { lobbyKind: 'standing' }),
  'template.read': on(['template'], null, read),
  'entry.submit': on(['entry'], null, tournament),
  'entry.withdraw': on(['entry'], null, tournament),
  'entry.read': on(['entry'], null, tournamentRead),
  'judge.invitation.respond': on(['judge'], null, tournament),
  'judge.availability.update': on(['judge'], null, tournament),
  'posting.read': on(['draw'], 'lobby', tournamentRead),
  'result.read': on(['fixture'], 'lobby', tournamentRead),
  'ballot.read': on(['ballot'], 'lobby', tournamentRead),
  'standings.read': on(['lobby'], 'lobby', tournamentRead),
  'resolution.read': on(['tab_round'], 'lobby', tournamentRead),
  'command.confirm': on(['pending_command'], null),
  'command.withdraw': on(['pending_command'], null),
  'sanction.read': on(['sanction'], null, read),
};

const grantable: readonly string[] = permissionSchema.options;
/**
 * What each capability applies to, read by the evaluator and by anything
 * that must know a capability without deciding it.
 */
export const capabilityMetadata = Object.fromEntries(
  Object.entries(rows).map(([capability, row]) => [
    capability,
    { ...row, grantable: grantable.includes(capability) },
  ]),
) as Record<AuthorizationCapability, CapabilityMetadata>;
