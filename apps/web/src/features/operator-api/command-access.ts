import {
  authorize,
  type AuthorizationPrincipal,
} from '@daisy/auth/authorization';
import type { OperatorCommandState } from '@daisy/protocol/operator';

/** Receipt readback uses the scope of the resource its command changed. */
export function mayReadOperatorCommand(
  principal: AuthorizationPrincipal,
  action: OperatorCommandState['action'],
): boolean {
  if (action === 'flag.state.update' || action === 'flag.override.update')
    return authorize({
      principal,
      capability: 'flag.command.read',
      resource: { kind: 'flag_control' },
      context: { account: null },
    }).allow;
  return authorize({
    principal,
    capability:
      action === 'beta.preapproval.update'
        ? 'beta.preapproval.read'
        : 'account.collection.read',
    resource: { kind: 'account_collection' },
    context: { account: null },
  }).allow;
}
