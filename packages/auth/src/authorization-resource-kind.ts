import type { AuthorizationCapability } from '@daisy/protocol/authorization';
import { capabilityMetadata } from '@daisy/protocol/capability-metadata';
import { lobbyScopeOf } from './authorization-boundary';
import type { AuthorizationInput } from './authorization-facts';

/**
 * Whether a capability may be asked of a resource: a resource kind it names,
 * in the lobby kind and the organization kind it means something in. A
 * tournament capability asked of a standing lobby is the wrong kind.
 */
export function validResourceKind(
  capability: AuthorizationCapability,
  resource: AuthorizationInput['resource'],
): boolean {
  const { resourceKinds, lobbyKind, organizationKind } =
    capabilityMetadata[capability];
  if (!resourceKinds.includes(resource.kind)) return false;
  if (
    resource.kind === 'organization' &&
    organizationKind !== null &&
    resource.organizationKind !== organizationKind
  )
    return false;
  const scope = lobbyScopeOf(resource);
  return lobbyKind === null || scope === null || scope.lobbyKind === lobbyKind;
}
