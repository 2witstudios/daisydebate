import { z } from 'zod';
/**
 * A permission is a capability a role may hold. A grant gives a role to a
 * person at an organization or a lobby; the rest of the capabilities are
 * never in a role.
 */
const permissions = [
  'organization.manage',
  'organization.roles.manage',
  'lobby.setup.manage',
  'lobby.announce',
  'action_history.read',
  'tournament.entries.manage',
  'tournament.draw.edit',
  'tournament.draw.publish',
  'tournament.rooms.officiate',
  'tournament.results.enter',
  'tournament.results.release',
  'tournament.ballots.read_unreleased',
  'tournament.resolutions.read_unreleased',
  'school.roster.manage',
  'school.ballots.read',
] as const;
export const permissionSchema = z.enum(permissions);
export type Permission = z.infer<typeof permissionSchema>;
/** Closed vocabulary: every capability the evaluator answers. */
const authorizationCapabilities = [
  'social.block',
  'social.friend.request',
  'social.friend.end',
  'social.friend.list',
  'social.challenge.send',
  'social.challenge.accept',
  'social.challenge.decline',
  'social.challenge.cancel',
  'social.challenge.list',
  'social.people.list',
  'social.report',
  'social.rating_visibility.read',
  'social.rating_visibility.update',
  'social.moderation_notice.read',
  'social.moderation_notice.acknowledge',
  'social.presence.read',
  'social.presence.update',
  'channel.retained.read',
  'channel.retained.delete',
  'channel.dm.request',
  'channel.create.private_group',
  'foundation.create',
  'foundation.read',
  'round.read',
  'round.observe.undelayed',
  'round.transcript.read',
  'round.analysis.read',
  'round.analysis.request',
  'member.history.read',
  'room.create',
  'room.list',
  'room.read',
  'room.join',
  'room.manage',
  'room.ready',
  'room.leave',
  /** A seated debater's strike; the engine decides whose turn it is. */
  'channel.inbox.read',
  'channel.read',
  'channel.preferences.read',
  'channel.preferences.update',
  'channel.preferences.clear',
  'channel.post',
  'channel.message.remove',
  'channel.reaction.remove',
  'channel.file.cleanup',
  'channel.manage',
  'channel.leave',
  'channel.group.result',
  'channel.group.revoke',
  'channel.group.archive',
  'channel.group.invite',
  'channel.invitation.read',
  'channel.invitation.accept',
  'channel.invitation.decline',
  'channel.invitation.cancel',
  'channel.invitation.result',
  'channel.subscribe',
  'channel.request.status',
  'channel.request.read',
  'channel.request.result',
  'channel.request.decide',
  'channel.request.cancel',
  // ADR 0079: the operator service's closed capabilities, never a user's.
  'beta.preapproval.read',
  'beta.preapproval.update',
  'account.collection.read',
  'flag.state.update',
  'flag.override.update',
  'flag.command.read',
  'account.beta_access.update',
  // WATCH-7: operator content moderation, recorded in ADR 0079.
  'content_report.queue.read',
  'content_report.resolve',
  'broadcast.stop',
  'broadcast.chat_slow_mode.update',
  'recording.takedown',
  'recording.restore',
  'recording.remove',
  'recording.legal_remove',
  'recording.rebuild',
  'recording.rebuildable.read',
  'chat_message.remove',
  'account.audience_ban.update',
  'report.collection.read',
  'report.resolve',
  'moderation.collection.read',
  'moderation.lift',
  ...permissions,
  // Decided from who the person is to the resource; never part of a role.
  'organization.create',
  'organization.read',
  'organization.host.read',
  'organization.membership.respond',
  'organization.membership.leave',
  'organization.owner.transfer',
  'guardian.link.create',
  'guardian.link.manage',
  'guardian.link.read',
  'lobby.create',
  'lobby.read',
  'lobby.host.read',
  'lobby.room.create',
  'template.read',
  'entry.submit',
  'entry.withdraw',
  'entry.read',
  'judge.invitation.respond',
  'judge.availability.update',
  'posting.read',
  'result.read',
  'ballot.read',
  'standings.read',
  'resolution.read',
  'command.confirm',
  'command.withdraw',
  'sanction.read',
] as const;
export const authorizationCapabilitySchema = z.enum(authorizationCapabilities);
export type AuthorizationCapability = z.infer<
  typeof authorizationCapabilitySchema
>;
/**
 * Internal decision reason vocabulary; no serialized deny-reason reader
 * exists. `conflict` and `confirmation-required` answer a person connected to
 * a fixture, `restricted` a minor outside their guardian's lobbies, and
 * `age-band` a person below the band an authority needs.
 */
export type AuthorizationDenyReason =
  | 'denied'
  | 'account-erased'
  | 'unauthenticated'
  | 'missing-capability'
  | 'conflict'
  | 'confirmation-required'
  | 'restricted'
  | 'age-band';

/** How a person with authority is connected to a fixture's Room. */
export const conflictConnectionSchema = z.enum([
  'seated',
  'school_entry',
  'ward',
  'declared',
]);
export type ConflictConnection = z.infer<typeof conflictConnectionSchema>;
/** What a conflict does to the authority: the `conflict.handling` values. */
export const conflictHandlingSchema = z.enum([
  'denied',
  'second_confirms',
  'flagged',
]);
export type ConflictHandling = z.infer<typeof conflictHandlingSchema>;
