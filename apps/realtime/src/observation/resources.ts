import type {
  ObservationResource,
  ObservationResourceKind,
} from '@daisy/protocol';
import type { SocketPrincipal } from '../subscription-state';
import type { PermitDecision } from './permits';

/** The durable header an owner polls: PostgreSQL's current revisions. */
export type ObservationHeader = {
  readonly contentRevision: number;
  readonly disclosureRevision: number;
};
/** One built snapshot for one base, from one coherent read. */
type ObservationProjection = {
  readonly partition: string;
  readonly disclosureRevision: number;
  readonly contentRevision: number;
  readonly body: unknown;
};

/**
 * What a feature declares to adopt shared observation (ADR 0089). The
 * interest, owner, cache, fanout and provider machinery is generic; a
 * Round spectator view later adds one definition with its own projector
 * and audience permit evaluator, and nothing else changes.
 */
export type ObservableResource = {
  readonly kind: ObservationResourceKind;
  /** Owner only, headers lane: one batched query for every owned resource. Missing ids are deleted resources. */
  readonly readHeaders: (
    ids: readonly string[],
  ) => Promise<ReadonlyMap<string, ObservationHeader>>;
  /** Owner only, projection lane: the bounded shared snapshot, or null when the resource is gone. */
  readonly project: (id: string) => Promise<ObservationProjection | null>;
  /**
   * Admission or renewal lane: one canonical read per resource for every
   * principal asking now, shared cohort facts loaded once. One decision per
   * principal, in order.
   */
  readonly evaluatePermits: (input: {
    readonly id: string;
    readonly principals: readonly SocketPrincipal[];
    readonly lane: 'admission' | 'renewal';
  }) => Promise<readonly PermitDecision[]>;
  /** Validates a body fetched from Redis before it is encoded once for fanout. */
  readonly parseBody: (body: unknown) => unknown | null;
};

export type ObservableResources = ReadonlyMap<
  ObservationResourceKind,
  ObservableResource
>;
export function defineObservableResources(
  definitions: readonly ObservableResource[],
): ObservableResources {
  const map = new Map<ObservationResourceKind, ObservableResource>();
  for (const definition of definitions) {
    if (map.has(definition.kind))
      throw new Error('Duplicate observable resource kind');
    map.set(definition.kind, definition);
  }
  return map;
}
export const definitionFor = (
  resources: ObservableResources,
  resource: ObservationResource,
) => resources.get(resource.kind) ?? null;
