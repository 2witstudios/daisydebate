import type { AuthorizationCapability } from '@daisy/protocol/authorization';
import { capabilityMetadata } from '@daisy/protocol/capability-metadata';
import { lobbyScopeOf } from './authorization-boundary';
import type { AuthorizationInput } from './authorization-facts';

type Resource = AuthorizationInput['resource'];
const eventKinds: readonly Resource['kind'][] = [
  'entry',
  'judge',
  'tab_round',
  'draw',
  'fixture',
  'ballot',
  'sanction',
];
/** An event's thing: its facts name a tournament and nothing else. */
const eventThing = (resource: Resource): boolean => {
  if (resource.kind === 'pending_command') return eventThing(resource.target);
  return resource.kind === 'room' || resource.kind === 'round'
    ? resource.owner?.kind === 'event'
    : eventKinds.includes(resource.kind);
};

/**
 * Whether a capability may be asked of a resource: a resource kind it names,
 * in the lobby kind and the organization kind it means something in. A
 * tournament capability asked of a standing lobby is the wrong kind, and so
 * is any question about an event's thing placed in one: the fact types
 * cannot write it, and a loader that does is refused here.
 */
export function validResourceKind(
  capability: AuthorizationCapability,
  resource: Resource,
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
  if (scope?.lobbyKind === 'standing' && eventThing(resource)) return false;
  return lobbyKind === null || scope === null || scope.lobbyKind === lobbyKind;
}
