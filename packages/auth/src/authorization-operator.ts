import type { AuthorizationCapability } from '@daisy/protocol/authorization';
import type {
  AuthorizationDecision,
  AuthorizationInput,
  AuthorizationPrincipal,
} from './authorization-facts';

type Resource = AuthorizationInput['resource'];
type OperatorResource = Extract<
  Resource,
  { kind: 'account' | 'account_collection' }
>;

/** ADR 0079: capabilities only the operator service may hold. */
const operatorCapabilities: readonly AuthorizationCapability[] = [
  'account.collection.read',
  'account.beta_access.update',
];

/** The resources only operator capabilities address. */
export const operatorResource = (
  resource: Resource,
): resource is OperatorResource =>
  resource.kind === 'account' || resource.kind === 'account_collection';

/**
 * The operator service holds exactly its configured capabilities and
 * nothing else; nobody else holds them. A beta access change also needs a
 * live target that has a beta row (a claimed username).
 */
export function operatorDecision(
  principal: AuthorizationPrincipal,
  capability: AuthorizationCapability,
  context: AuthorizationInput['context'],
): AuthorizationDecision {
  if (
    principal.kind !== 'operator_service' ||
    !operatorCapabilities.includes(capability) ||
    !principal.capabilities.includes(capability)
  )
    return { allow: false, reason: 'missing-capability' };
  if (capability === 'account.collection.read') return { allow: true };
  return context.account !== null && context.account.beta !== null
    ? { allow: true }
    : { allow: false, reason: 'denied' };
}
