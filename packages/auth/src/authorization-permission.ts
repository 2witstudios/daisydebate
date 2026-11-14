import {
  permissionSchema,
  type AuthorizationCapability,
  type Permission,
} from '@daisy/protocol/authorization';
import {
  allowRelated,
  allowUnder,
  deny,
  type AuthorizationDecision,
  type DecisionAuthority,
} from './authorization-decision';
import type { AuthorizationInput } from './authorization-facts';
import { givingDecision } from './authorization-giving';
import {
  bandAtLeast,
  holdingDecision,
  holds,
  type AuthorityTarget,
  type Holder,
} from './authorization-holding';
import type {
  LobbyResourceFact,
  LobbyScopeFact,
  OrganizationAuthorizationFact,
} from './authorization-lobby-facts';

export type LobbyRuleContext = AuthorizationInput['context'];
/** The lobby resource of one kind. */
export type ResourceOf<Kind extends LobbyResourceFact['kind']> = Extract<
  LobbyResourceFact,
  { kind: Kind }
>;

const isPermission = (
  capability: AuthorizationCapability,
): capability is Permission => permissionSchema.safeParse(capability).success;
export const lobbyTarget = (scope: LobbyScopeFact): AuthorityTarget => ({
  kind: 'lobby',
  scope,
});
export const organizationTarget = (
  fact: OrganizationAuthorizationFact,
): AuthorityTarget => ({ kind: 'organization', organization: fact });
/** Allowed under an authority, or not held when there is none. */
export const authorityDecision = (
  authority: DecisionAuthority | null,
): AuthorizationDecision =>
  authority ? allowUnder(authority) : deny('missing-capability');
/** A relation that also needs the adult band. */
export const adultRelation = (
  holder: Holder,
  related: boolean,
  relation: Parameters<typeof allowRelated>[0],
): AuthorizationDecision => {
  if (!related) return deny('missing-capability');
  return bandAtLeast(holder.ageBand, 'adult')
    ? allowRelated(relation)
    : deny('age-band');
};

/** A permission on the target; giving a role also proves the role itself. */
export function permissionDecision(
  holder: Holder,
  capability: AuthorizationCapability,
  target: AuthorityTarget,
  context: LobbyRuleContext,
): AuthorizationDecision {
  if (!isPermission(capability)) return deny('missing-capability');
  return capability === 'organization.roles.manage'
    ? givingDecision(holder, target, context.roleGiven)
    : holdingDecision(holds(holder, capability, target));
}
