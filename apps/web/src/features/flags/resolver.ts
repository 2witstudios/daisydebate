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
  releaseDefault: boolean,
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
  if (entry.kind === 'release' && releaseDefault)
    return { enabled: true, reason: 'ENVIRONMENT' };
  return { enabled: entry.safeDefault, reason: 'DEFAULT' };
}

/**
 * Pure, total release/ops resolution. Facts belong to one server-selected
 * subject. `releaseDefault` is the deployment's default for a release flag
 * with no stored choice (staging only, ADR 0118): a stored state or override
 * still wins, and it never reopens a killed, expired or unreadable flag.
 */
export function resolveFlag({
  catalogue,
  snapshot,
  key,
  now,
  releaseDefault,
}: {
  readonly catalogue: readonly FlagDefinition[];
  readonly snapshot: FlagSnapshot;
  readonly key: string;
  readonly now: number;
  readonly releaseDefault: boolean;
}): FlagResolution {
  const entries = new Map(catalogue.map((entry) => [entry.key, entry]));
  const target = entries.get(key);
  if (!target) return { enabled: false, reason: 'UNKNOWN' };
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
  const resolve = (entry: FlagDefinition): FlagResolution => {
    const previous = resolved.get(entry.key);
    if (previous) return previous;
    let result = ownResolution(
      entry,
      facts.get(entry.key),
      snapshot,
      now,
      releaseDefault,
    );
    if (
      result.enabled &&
      // catalogueProblems refused an unknown dependency, so each is found.
      !entry.dependencies.every((key) => {
        const dependency = entries.get(key);
        return dependency !== undefined && resolve(dependency).enabled;
      })
    )
      result = { enabled: false, reason: 'DEPENDENCY' };
    resolved.set(entry.key, result);
    return result;
  };
  return resolve(target);
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
