import { CryptoHasher } from 'bun';
import { createAppError } from '@daisy/errors';
import type {
  ObservationDependency,
  ObservationEvidence,
} from './observation-contracts';
export function requireObservationDependencies(
  dependencies: readonly ObservationDependency[],
) {
  if (
    dependencies.length > 4096 ||
    dependencies.some(
      (d) => !['subject', 'cohort', 'entitlement'].includes(d.scope),
    )
  )
    throw createAppError('INFRASTRUCTURE');
}

/** Fingerprints describe semantic facts; acquisition timestamps never enter identity. */
export function observationEvidence(
  dependencies: readonly ObservationDependency[],
  databaseNow: string,
  deadline: string | null,
): ObservationEvidence {
  const now = Date.parse(databaseNow);
  requireObservationDependencies(dependencies);
  if (!Number.isFinite(now) || dependencies.length > 4096)
    throw createAppError('INFRASTRUCTURE');
  const facts = [...dependencies].sort(
    (a, b) =>
      a.key.localeCompare(b.key) || a.revision.localeCompare(b.revision),
  );
  if (
    facts.some(
      (fact) =>
        typeof fact.key !== 'string' ||
        fact.key.length < 1 ||
        fact.key.length > 200 ||
        typeof fact.revision !== 'string' ||
        fact.revision.length > 512,
    )
  )
    throw createAppError('INFRASTRUCTURE');
  const boundaries = [deadline, ...facts.map((fact) => fact.nextBoundary)]
    .filter((value): value is string => value !== null)
    .map(Date.parse);
  if (boundaries.some((value) => !Number.isFinite(value)))
    throw createAppError('INFRASTRUCTURE');
  const remainingMs = Math.max(
    0,
    Math.min(5000, ...boundaries.map((value) => value - now)),
  );
  const unique = new Map<string, string>();
  for (const { key, revision } of facts) {
    if (unique.has(key) && unique.get(key) !== revision)
      throw createAppError('INFRASTRUCTURE');
    unique.set(key, revision);
  }
  const vector = [...unique].map(([key, revision]) => ({ key, revision }));
  return {
    fingerprint: new CryptoHasher('sha3-256')
      .update(JSON.stringify(vector))
      .digest('hex'),
    dependencies: vector,
    remainingMs,
  };
}
