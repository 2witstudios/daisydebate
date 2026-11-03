import type { AuthorizationCapability } from '@daisy/protocol/authorization';
import type {
  AuthorizationDecision,
  AuthorizationInput,
  AuthorizationPrincipal,
} from './authorization-facts';

type Resource = AuthorizationInput['resource'];
type OperatorResource = Extract<
  Resource,
  { kind: 'account' | 'account_collection' | 'moderation' }
>;

/** WATCH-7: decided on holding them alone; each store checks its own target. */
const moderationCapabilities: readonly AuthorizationCapability[] = [
  'report.queue.read',
  'report.resolve',
  'broadcast.stop',
  'broadcast.chat_slow_mode.update',
  'recording.takedown',
  'chat_message.remove',
  'account.audience_ban.update',
];

/** ADR 0079: capabilities only the operator service may hold. */
const operatorCapabilities: readonly AuthorizationCapability[] = [
  'account.collection.read',
  'account.beta_access.update',
  ...moderationCapabilities,
];

/** The resources only operator capabilities address. */
export const operatorResource = (
  resource: Resource,
): resource is OperatorResource =>
  resource.kind === 'account' ||
  resource.kind === 'account_collection' ||
  resource.kind === 'moderation';

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
  if (
    capability === 'account.collection.read' ||
    moderationCapabilities.includes(capability)
  )
    return { allow: true };
  return context.account !== null && context.account.beta !== null
    ? { allow: true }
    : { allow: false, reason: 'denied' };
}
