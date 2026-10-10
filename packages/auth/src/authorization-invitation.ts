import {
  contactSafetyAllowed,
  sameAuthorizationAccount,
} from './authorization-contact';
import { socialGroupAdmissionAllowed } from './authorization-creation';
import type {
  AuthorizationCapability,
  AuthorizationInput,
  GroupInvitationAuthorizationFact,
} from './authorization-facts';
const positive = (value: number) => Number.isSafeInteger(value) && value > 0;
const identifier = (value: string) =>
  typeof value === 'string' && value.length > 0;
function channelCurrent(channel: GroupInvitationAuthorizationFact['channel']) {
  return (
    identifier(channel.channelId) &&
    channel.kind === 'private_group' &&
    channel.policyKey === 'social.private_group' &&
    positive(channel.policyRevision) &&
    positive(channel.revision) &&
    ['active', 'archived'].includes(channel.lifecycle) &&
    channel.activeMemberActorIds.every(identifier) &&
    new Set(channel.activeMemberActorIds).size ===
      channel.activeMemberActorIds.length
  );
}
function invitationCurrent(resource: GroupInvitationAuthorizationFact) {
  const { channel, invitation } = resource;
  return (
    channelCurrent(channel) &&
    invitation.channelId === channel.channelId &&
    positive(invitation.generation) &&
    identifier(invitation.inviterActorId) &&
    identifier(invitation.inviteeActorId) &&
    invitation.inviterActorId !== invitation.inviteeActorId &&
    ['pending', 'accepted', 'declined', 'cancelled'].includes(
      invitation.state,
    ) &&
    grantCurrent(resource)
  );
}
function grantCurrent({
  invitation,
  inviterGrant,
}: GroupInvitationAuthorizationFact) {
  return (
    inviterGrant.actorId === invitation.inviterActorId &&
    Number.isSafeInteger(inviterGrant.generation) &&
    inviterGrant.generation >= 0 &&
    ['manager', 'member', null].includes(inviterGrant.role) &&
    (inviterGrant.role === null || positive(inviterGrant.generation))
  );
}
function invitationAccountsCurrent(
  actorId: string,
  resource: GroupInvitationAuthorizationFact,
  context: AuthorizationInput['context'],
) {
  const { inviterActorId, inviteeActorId } = resource.invitation;
  const [low, high] = [inviterActorId, inviteeActorId].sort();
  const pairs = resource.contactPairs.filter(
    (pair) => pair.lowActorId === low && pair.highActorId === high,
  );
  return (
    pairs.length === 1 && contactSafetyAllowed(actorId, pairs[0]!, context)
  );
}
function admissionAccountsCurrent(context: AuthorizationInput['context']) {
  return (
    context.contactAccounts?.every((account) => {
      const row = context.socialAccounts?.find(
        (row) => row.account.actorId === account.actorId,
      );
      return (
        row !== undefined && sameAuthorizationAccount(account, row.account)
      );
    }) === true
  );
}
function acceptInvitation(
  resource: GroupInvitationAuthorizationFact,
  context: AuthorizationInput['context'],
) {
  const { channel, invitation, inviterGrant } = resource;
  const members = channel.activeMemberActorIds;
  if (
    channel.lifecycle !== 'active' ||
    inviterGrant.role !== 'manager' ||
    !members.includes(invitation.inviterActorId) ||
    members.includes(invitation.inviteeActorId) ||
    !admissionAccountsCurrent(context)
  )
    return false;
  return socialGroupAdmissionAllowed(
    {
      kind: 'social_creation',
      mode: 'private_group',
      initiatorActorId: invitation.inviterActorId,
      memberActorIds: [...members, invitation.inviteeActorId],
      policyKey: channel.policyKey,
      policyRevision: channel.policyRevision,
      contactPairs: resource.contactPairs,
    },
    context,
  );
}
function closedResult(
  actorId: string,
  resource: GroupInvitationAuthorizationFact,
) {
  const invitation = resource.invitation;
  return invitation.state === 'cancelled'
    ? actorId === invitation.inviterActorId
    : ['accepted', 'declined'].includes(invitation.state) &&
        actorId === invitation.inviteeActorId;
}
function invitationAction(
  actorId: string,
  capability: AuthorizationCapability,
  resource: GroupInvitationAuthorizationFact,
  context: AuthorizationInput['context'],
) {
  if (capability === 'channel.invitation.result')
    return closedResult(actorId, resource);
  if (resource.invitation.state !== 'pending') return false;
  if (capability === 'channel.invitation.cancel')
    return actorId === resource.invitation.inviterActorId;
  if (actorId !== resource.invitation.inviteeActorId) return false;
  if (capability === 'channel.invitation.decline') return true;
  return (
    capability === 'channel.invitation.accept' &&
    acceptInvitation(resource, context)
  );
}
/** Minimal invitation association only; no content, history or membership is granted. */
export function groupInvitationAllowed(
  actorId: string,
  capability: AuthorizationCapability,
  resource: GroupInvitationAuthorizationFact,
  context: AuthorizationInput['context'],
): boolean {
  if (
    !invitationCurrent(resource) ||
    !invitationAccountsCurrent(actorId, resource, context)
  )
    return false;
  if (capability === 'channel.invitation.read')
    return (
      resource.invitation.state === 'pending' &&
      actorId === resource.invitation.inviteeActorId
    );
  if (
    !positive(resource.expectedGeneration ?? 0) ||
    resource.expectedGeneration !== resource.invitation.generation
  )
    return false;
  return invitationAction(actorId, capability, resource, context);
}
