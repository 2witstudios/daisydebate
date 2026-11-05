import { catalogueProblems } from './catalogue-validation';
import type { FlagDefinition, FlagResolution, FlagSnapshot } from './model';

/** Pure, total release/ops resolution. Facts belong to one server-selected subject. */
export function resolveFlag({
  catalogue,
  snapshot,
  key,
  now,
}: {
  readonly catalogue: readonly FlagDefinition[];
  readonly snapshot: FlagSnapshot;
  readonly key: string;
  readonly now: number;
}): FlagResolution {
  const entries = new Map(catalogue.map((entry) => [entry.key, entry]));
  if (!entries.has(key)) return { enabled: false, reason: 'UNKNOWN' };
  if (!Number.isFinite(now) || catalogueProblems(catalogue).length > 0)
    return { enabled: false, reason: 'ERROR' };
  const facts = new Map(
    snapshot.kind === 'available'
      ? snapshot.flags.map((fact) => [fact.key, fact])
      : [],
  );
  if (snapshot.kind === 'available' && facts.size !== snapshot.flags.length)
    return { enabled: false, reason: 'ERROR' };
  const resolved = new Map<string, FlagResolution>();
  const resolve = (name: string): FlagResolution => {
    const previous = resolved.get(name);
    if (previous) return previous;
    const entry = entries.get(name)!;
    const fact = facts.get(name);
    let result: FlagResolution;
    if (
      entry.kind === 'release' &&
      now >= Date.parse(entry.expiresOn) + 86_400_000
    )
      result = { enabled: false, reason: 'EXPIRED' };
    else if (fact?.state === 'killed')
      result = { enabled: false, reason: 'DISABLED' };
    else if (snapshot.kind === 'unavailable')
      result = { enabled: entry.safeDefault, reason: 'ERROR' };
    else if (
      entry.kind === 'release' &&
      fact?.override &&
      fact.override.expiresAt > now
    )
      result = { enabled: fact.override.enabled, reason: 'TARGETING_MATCH' };
    else if (fact && fact.state !== 'default')
      result = { enabled: fact.state === 'enabled', reason: 'STATIC' };
    else result = { enabled: entry.safeDefault, reason: 'DEFAULT' };
    if (
      result.enabled &&
      !entry.dependencies.every((dependency) => resolve(dependency).enabled)
    )
      result = { enabled: false, reason: 'DEPENDENCY' };
    resolved.set(name, result);
    return result;
  };
  return resolve(key);
}
