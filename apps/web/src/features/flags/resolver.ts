import { catalogueProblems } from './catalogue-validation';
import type {
  FlagDefinition,
  FlagFact,
  FlagResolution,
  FlagSnapshot,
} from './model';

/** Precedence is local; dependency closure is evaluated separately below. */
function ownResolution(
  entry: FlagDefinition,
  fact: FlagFact | undefined,
  snapshot: FlagSnapshot,
  now: number,
): FlagResolution {
  if (fact?.state === 'killed') return { enabled: false, reason: 'DISABLED' };
  if (
    entry.kind === 'release' &&
    now >= Date.parse(entry.expiresOn) + 86_400_000
  )
    return { enabled: false, reason: 'EXPIRED' };
  if (snapshot.kind === 'unavailable')
    return { enabled: entry.safeDefault, reason: 'ERROR' };
  const targeting = targetingResolution(entry, fact, now);
  if (targeting) return targeting;
  if (fact && fact.state !== 'default')
    return { enabled: fact.state === 'enabled', reason: 'STATIC' };
  return { enabled: entry.safeDefault, reason: 'DEFAULT' };
}

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
    let result = ownResolution(entry, facts.get(name), snapshot, now);
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

function targetingResolution(
  entry: FlagDefinition,
  fact: FlagFact | undefined,
  now: number,
): FlagResolution | null {
  if (entry.kind !== 'release') return null;
  const override = fact?.override;
  return override && override.expiresAt > now
    ? { enabled: override.enabled, reason: 'TARGETING_MATCH' }
    : null;
}
