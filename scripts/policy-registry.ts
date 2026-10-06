// The shared shape of every `policy/*.json` registry: a list of entries, each
// naming an owner, an ADR, a reason and a review date, each validated against
// the repository's real paths. `policy.ts`, `policy-baselines.ts` and
// `planned-readers.ts` each validate one registry; the checks they share live
// here so a new registry cannot drift its wording or its expiry rule.
//
// The expiry rule itself is `review-date.ts`, shared with `bun migrations:check`.

import { reviewDateStatus, utcToday } from './review-date';

export type RegistryEntryOptions = {
  readonly knownPaths?: ReadonlySet<string>;
  readonly today?: string;
};

type Fields = Readonly<Record<string, unknown>>;

/**
 * A registry entry must be a plain object. This is validation code, so it may
 * not assume well-formed input: a `null`, a string or a number in the array
 * must be reported, not crash the gate with a TypeError.
 */
export function entryObjectProblems(
  entry: unknown,
  prefix: string,
): readonly string[] {
  return typeof entry === 'object' && entry !== null && !Array.isArray(entry)
    ? []
    : [`${prefix}: entry must be an object`];
}

/** One problem per missing field, in the order the fields are listed. */
export function requiredFieldProblems(
  entry: Fields,
  prefix: string,
  fields: readonly string[],
): readonly string[] {
  return fields
    .filter(
      (field) => typeof entry[field] !== 'string' || entry[field].trim() === '',
    )
    .map((field) => `${prefix}: ${field} is required`);
}

/**
 * A repository path that must exist and must not be a wildcard. A malformed
 * reference is one problem, not two: a wildcard would otherwise also be
 * reported as missing.
 */
export function pathProblems(
  path: unknown,
  prefix: string,
  knownPaths: ReadonlySet<string> | undefined,
): readonly string[] {
  if (typeof path !== 'string') return [];
  if (path.includes('*')) return [`${prefix}: wildcard paths are not allowed`];
  return knownPaths && !knownPaths.has(path)
    ? [`${prefix}: path does not exist: ${path}`]
    : [];
}

/** An ADR reference that must be a real decision record that exists. */
export function adrProblems(
  adr: unknown,
  prefix: string,
  knownPaths: ReadonlySet<string> | undefined,
): readonly string[] {
  if (typeof adr !== 'string') return [];
  if (!/^docs\/decisions\/\d{4}-[a-z0-9-]+\.md$/.test(adr))
    return [`${prefix}: invalid ADR reference ${adr}`];
  return knownPaths && !knownPaths.has(adr)
    ? [`${prefix}: ADR does not exist: ${adr}`]
    : [];
}

/**
 * A named export that the file really declares. An index the caller supplies
 * lets the gate prove the declaration names a symbol rather than a fiction;
 * with no index available the check is skipped rather than guessed.
 */
export function exportedSymbolProblems(
  path: unknown,
  symbol: unknown,
  prefix: string,
  exportNames: ReadonlyMap<string, readonly string[]> | undefined,
): readonly string[] {
  if (typeof path !== 'string' || typeof symbol !== 'string') return [];
  const declared = exportNames?.get(path);
  if (declared === undefined) return [];
  return declared.includes(symbol)
    ? []
    : [`${prefix}: ${path} does not export ${symbol}`];
}

/**
 * The preamble every registry shares: version 1, and a named array field. The
 * named field lets the error name what is missing rather than saying "entries".
 */
export function registryShapeProblems(
  registry: Fields,
  field: string,
): readonly string[] {
  const problems: string[] = [];
  if (registry.version !== 1) problems.push('registry: version must be 1');
  if (!Array.isArray(registry[field]))
    problems.push(`registry: ${field} must be an array`);
  return problems;
}

/** The shared expiry rule: a real UTC calendar day, judged against today. */ export function reviewDateProblems(
  reviewBy: unknown,
  prefix: string,
  today: string = utcToday(),
): readonly string[] {
  if (typeof reviewBy !== 'string') return [];
  const status = reviewDateStatus(reviewBy, today);
  if (status === 'invalid') return [`${prefix}: reviewBy must be an ISO date`];
  return status === 'expired'
    ? [`${prefix}: reviewBy has expired: ${reviewBy}`]
    : [];
}
