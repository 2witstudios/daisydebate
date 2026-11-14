import type {
  AuthorizationCapability,
  AuthorizationDenyReason,
} from '@daisy/protocol/authorization';
import { capabilityMetadata } from '@daisy/protocol/capability-metadata';
import {
  deny,
  type AuthorizationDecision,
  type Conflict,
} from './authorization-decision';
import type { AuthorizationInput } from './authorization-facts';
import type { ConflictFact } from './authorization-lobby-facts';

type Resource = AuthorizationInput['resource'];

/** The principal's conflict facts for the fixture a resource belongs to. */
function conflictFactOf(resource: Resource): ConflictFact | null {
  if (resource.kind === 'fixture' || resource.kind === 'ballot')
    return resource.conflict;
  if (resource.kind === 'pending_command')
    return conflictFactOf(resource.target);
  if (resource.kind === 'room' || resource.kind === 'round')
    return resource.owner?.kind === 'event' ? resource.owner.conflict : null;
  return null;
}

/** A conflict exists exactly when the person has a connection. */
export function conflictOf(resource: Resource): Conflict | null {
  const fact = conflictFactOf(resource);
  return fact !== null && fact.connections.length > 0
    ? {
        connections: fact.connections,
        handling: fact.handling,
        waiverId: fact.waiverId,
      }
    : null;
}

/**
 * Why a connected person's authority does not stand, or null when it does:
 * `flagged` lets it stand, `denied` never does, and `second_confirms` needs
 * a second person's confirmed waiver.
 */
export function conflictRefusal(
  conflict: Conflict | null,
): Extract<
  AuthorizationDenyReason,
  'conflict' | 'confirmation-required'
> | null {
  if (conflict === null || conflict.handling === 'flagged') return null;
  if (conflict.handling === 'denied') return 'conflict';
  return conflict.waiverId === null ? 'confirmation-required' : null;
}

/**
 * Every decision on a fixture's resource carries the person's conflict, and
 * an allow of a conflict-sensitive capability stands only as the handling
 * says.
 */
export function withConflict(
  capability: AuthorizationCapability,
  resource: Resource,
  decided: AuthorizationDecision,
): AuthorizationDecision {
  const conflict = conflictOf(resource);
  if (conflict === null) return decided;
  const refusal =
    decided.allow && capabilityMetadata[capability].conflictSensitive
      ? conflictRefusal(conflict)
      : null;
  return refusal ? deny(refusal, conflict) : { ...decided, conflict };
}
