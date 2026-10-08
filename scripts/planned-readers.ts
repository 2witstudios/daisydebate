// The one rule that lets a foundation ship before its production reader
// exists: an export with no runtime consumer may be declared in
// `policy/planned-readers.json` when it names the committed task that will read
// it and a date to be judged by. `bun policy` validates the registry; ADR 0023
// decides how long a declaration may outlive the mistake that required it.
//
// This covers exactly the case ADR 0057 describes: an export that HAS some
// syntactic consumer -- usually a test, an integration suite or a harness -- so
// the dead-code gate already passes it, but whose intended runtime reader is a
// committed leaf away. It is not a permission to ship an export nothing at all
// reads; that still fails Knip, and this registry does not touch Knip.
//
// It is a declaration, not a suppression: a declared reader fails the gate on its
// review date, so a foundation nobody adopts goes red again instead of sitting in
// the repository forever. It exists because the alternative is worse — building
// the box and its reader in one change, or letting a table with no runtime reader
// pass unnoticed because a test happened to reference it.

import {
  adrProblems,
  entryObjectProblems,
  exportedSymbolProblems,
  pathProblems,
  registryShapeProblems,
  requiredFieldProblems,
  reviewDateProblems,
  type RegistryEntryOptions,
} from './policy-registry';
import { utcToday } from './review-date';

export type PlannedReader = {
  /** The file the export lives in. One named export, never a tree. */
  readonly path: string;
  /** The exported symbol that has no reader yet. */
  readonly export: string;
  /** The committed task that will read it (PageSpace task id). */
  readonly task: string;
  readonly owner: string;
  readonly adr: string;
  readonly reason: string;
  /** A real UTC calendar day; the declaration fails the gate the day after. */
  readonly reviewBy: string;
};

export type PlannedReaderValidationOptions = RegistryEntryOptions & {
  /**
   * The exported symbols each file really declares, keyed by repository path.
   * Supplied by the gate so a declaration cannot name a symbol that does not
   * exist; absent, the check is skipped rather than guessed.
   */
  readonly exportNames?: ReadonlyMap<string, readonly string[]>;
};

type ReaderEntry = Partial<PlannedReader>;

const requiredFields = [
  'path',
  'export',
  'task',
  'owner',
  'adr',
  'reason',
  'reviewBy',
] as const;

function referenceProblems(
  entry: ReaderEntry,
  prefix: string,
  knownPaths: ReadonlySet<string> | undefined,
  exportNames: ReadonlyMap<string, readonly string[]> | undefined,
): readonly string[] {
  return [
    ...pathProblems(entry.path, prefix, knownPaths),
    ...adrProblems(entry.adr, prefix, knownPaths),
    ...exportedSymbolProblems(entry.path, entry.export, prefix, exportNames),
  ];
}

export function validatePlannedReaders(
  registry: { version?: unknown; readers?: unknown },
  options: PlannedReaderValidationOptions = {},
): readonly string[] {
  const problems: string[] = [...registryShapeProblems(registry, 'readers')];
  const today = options.today ?? utcToday();
  const knownPaths = options.knownPaths;
  if (!Array.isArray(registry.readers)) return problems;
  const seen = new Set<string>();
  for (const [index, value] of registry.readers.entries()) {
    const prefix = `readers[${index}]`;
    const shape = entryObjectProblems(value, prefix);
    if (shape.length > 0) {
      problems.push(...shape);
      continue;
    }
    const entry = value as ReaderEntry;
    problems.push(...requiredFieldProblems(entry, prefix, requiredFields));
    problems.push(
      ...referenceProblems(entry, prefix, knownPaths, options.exportNames),
    );
    problems.push(...reviewDateProblems(entry.reviewBy, prefix, today));
    const key = `${entry.path}|${entry.export}`;
    if (seen.has(key)) problems.push(`${prefix}: duplicate ${key}`);
    seen.add(key);
  }
  return problems;
}
