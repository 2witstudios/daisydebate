import { idSchema } from '@daisy/protocol';
import { groupManagerCurrent } from './authorization-group-safety';
import { socialGroupAdmissionAllowed } from './authorization-creation';
import type {
  AuthorizationInput,
  GroupInvitationCreationAuthorizationFact,
} from './authorization-facts';
/** This is prospective issuance, never a fabricated invitation or membership grant. */
export function groupInvitationCreationAllowed(
  actorId: string,
  fact: GroupInvitationCreationAuthorizationFact,
  context: AuthorizationInput['context'],
): boolean {
  const channel = fact.channel;
  const grant = channel.authority;
  if (grant.kind !== 'private_group') return false;
  if (channel.lifecycle !== 'active' || !groupManagerCurrent(actorId, channel))
    return false;
  const targets = fact.inviteeActorIds;
  if (!targets.length || new Set(targets).size !== targets.length) return false;
  if (
    targets.some(
      (id) =>
        !idSchema.safeParse(id).success ||
        grant.activeMemberActorIds.includes(id),
    )
  )
    return false;
  return socialGroupAdmissionAllowed(
    {
      kind: 'social_creation',
      mode: 'private_group',
      initiatorActorId: actorId,
      memberActorIds: [...grant.activeMemberActorIds, ...targets],
      policyKey: 'social.private_group',
      policyRevision: channel.policyRevision,
      contactPairs: fact.contactPairs,
    },
    context,
  );
}
