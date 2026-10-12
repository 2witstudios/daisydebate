import { observationBaseKey, type ObservationBase } from '@daisy/protocol';

export type ObservationDependency = {
  readonly key: string;
  readonly revision: string;
};
export type ObservationEvidence = {
  readonly started: number;
  readonly expiresAt: number;
  readonly fingerprint: string;
  readonly dependencies: readonly ObservationDependency[];
};
/** Proposed five-second policy, with 100ms reserved for clock/settlement error.
 * This candidate does not authorize protected-payload activation.
 */
export function observationEvidence({
  started,
  remainingMs,
  fingerprint,
  dependencies,
}: {
  readonly started: number;
  readonly remainingMs: number;
  readonly fingerprint: string;
  readonly dependencies: readonly ObservationDependency[];
}): ObservationEvidence {
  if (
    !Number.isFinite(started) ||
    !Number.isFinite(remainingMs) ||
    remainingMs <= 100 ||
    !fingerprint
  )
    throw new Error('Unavailable observation evidence');
  return {
    started,
    expiresAt: started + Math.min(5000, remainingMs) - 100,
    fingerprint,
    dependencies,
  };
}
export type ObservationGrant = {
  readonly purgeGeneration: number;
  readonly base: ObservationBase;
  readonly minimumContentRevision: number;
  readonly subject: ObservationEvidence;
  readonly cohort: ObservationEvidence;
  readonly entitlement: ObservationEvidence;
};
export function createObservationPermit({
  now,
  nodeIncarnation,
}: {
  readonly now: () => number;
  readonly nodeIncarnation: string;
}) {
  let bindingGeneration = 0;
  let acquisition = 0;
  let active: ObservationGrant | undefined;
  const listeners = new Set<(recovered: boolean) => void>();
  let lastTime = now();
  function invalidate() {
    bindingGeneration += 1;
    active = undefined;
  }
  function instant() {
    const value = now();
    if (!Number.isFinite(value) || value < lastTime) {
      invalidate();
      return null;
    }
    lastTime = value;
    return value;
  }
  const parts = (grant: ObservationGrant) => [
    grant.subject,
    grant.cohort,
    grant.entitlement,
  ];
  function valid(grant: ObservationGrant, at: number) {
    return parts(grant).every(
      (part) =>
        Number.isFinite(part.started) &&
        Number.isFinite(part.expiresAt) &&
        part.started <= at &&
        at < part.expiresAt &&
        part.expiresAt <= part.started + 4900,
    );
  }
  return {
    begin() {
      return { bindingGeneration, acquisition: ++acquisition };
    },
    install(
      attempt: {
        readonly bindingGeneration: number;
        readonly acquisition: number;
      },
      grant: ObservationGrant,
    ) {
      const at = instant();
      if (
        at === null ||
        attempt.bindingGeneration !== bindingGeneration ||
        attempt.acquisition !== acquisition ||
        !valid(grant, at)
      )
        return false;
      const recovered = !active || !valid(active, at);
      active = grant;
      for (const listener of listeners) listener(recovered);
      return true;
    },
    /** Unknown clock/suspend state and infrastructure authority uncertainty fence all pending results. */
    uncertain: invalidate,
    invalidate(dependencyKey?: string) {
      if (
        dependencyKey === undefined ||
        !active ||
        parts(active).some((part) =>
          part.dependencies.some(
            (dependency) => dependency.key === dependencyKey,
          ),
        )
      )
        invalidate();
    },
    allows(
      base: ObservationBase,
      contentRevision: number,
      incarnation: string,
      purgeGeneration: number,
    ) {
      const at = instant();
      return (
        at !== null &&
        incarnation === nodeIncarnation &&
        active !== undefined &&
        active.purgeGeneration === purgeGeneration &&
        valid(active, at) &&
        observationBaseKey(base) === observationBaseKey(active.base) &&
        contentRevision >= active.minimumContentRevision
      );
    },
    grant: () => active,
    generation: () => bindingGeneration,
    subscribe(listener: (recovered: boolean) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
export type ObservationPermit = ReturnType<typeof createObservationPermit>;
