import type { AuthorizationCapability } from '@daisy/protocol/authorization';
import type {
  AuthorizationDecision,
  AuthorizationInput,
  AuthorizationPrincipal,
} from './authorization-facts';

type Resource = AuthorizationInput['resource'];
type OperatorResource = Extract<
  Resource,
  {
    kind:
      'account' | 'account_collection' | 'content_moderation' | 'flag_control';
  }
>;

/** WATCH-7: decided on holding them alone; each store checks its own target. */
const contentModerationCapabilities: readonly AuthorizationCapability[] = [
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
];

/** ADR 0079: capabilities only the operator service may hold. */
const operatorCapabilities: readonly AuthorizationCapability[] = [
  'account.collection.read',
  'flag.state.update',
  'flag.override.update',
  'flag.command.read',
  'account.beta_access.update',
  ...contentModerationCapabilities,
  'report.collection.read',
  'report.resolve',
  'moderation.collection.read',
  'moderation.lift',
];

/** The resources only operator capabilities address. */
export const operatorResource = (
  resource: Resource,
): resource is OperatorResource =>
  resource.kind === 'account' ||
  resource.kind === 'flag_control' ||
  resource.kind === 'account_collection' ||
  resource.kind === 'content_moderation';

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
  if (contentModerationCapabilities.includes(capability))
    return { allow: true };
  switch (capability) {
    case 'account.beta_access.update':
      return context.account !== null && context.account.beta !== null
        ? { allow: true }
        : { allow: false, reason: 'denied' };
    case 'account.collection.read':
    case 'flag.state.update':
    case 'flag.override.update':
    case 'flag.command.read':
    case 'report.collection.read':
    case 'report.resolve':
    case 'moderation.collection.read':
    case 'moderation.lift':
      return { allow: true };
    default:
      return { allow: false, reason: 'missing-capability' };
  }
}
