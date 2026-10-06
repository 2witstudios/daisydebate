// The greenfield baseline registry (`policy/migration-baselines.json`): a
// sanctioned history rewrite of the shared migration chain, recorded with the
// base hash it replaced and a date to be judged by. ADR 0038 defines what a
// baseline is; AGENTS.md makes it the only sanctioned way to rewrite applied
// migrations, at the cost of resetting every local and test database once.
//
// It lives here beside `planned-readers.ts` rather than in `policy.ts`, which
// would otherwise pass the repository's 400-line ceiling.

import {
  adrProblems,
  entryObjectProblems,
  registryShapeProblems,
  requiredFieldProblems,
  reviewDateProblems,
  type RegistryEntryOptions,
} from './policy-registry';
import { utcToday } from './review-date';

export type MigrationBaseline = {
  readonly baseMigrationsHash: string;
  readonly adr: string;
  readonly owner: string;
  readonly reason: string;
  readonly reviewBy: string;
};

export type BaselineValidationOptions = RegistryEntryOptions;

type BaselineEntry = Partial<MigrationBaseline>;

function baselineProblems(
  entry: BaselineEntry,
  prefix: string,
  options: BaselineValidationOptions,
  today: string,
): readonly string[] {
  const problems: string[] = [];
  problems.push(
    ...requiredFieldProblems(entry, prefix, [
      'baseMigrationsHash',
      'adr',
      'owner',
      'reason',
      'reviewBy',
    ]),
  );
  if (
    typeof entry.baseMigrationsHash === 'string' &&
    !/^sha256:[0-9a-f]{64}$/.test(entry.baseMigrationsHash)
  )
    problems.push(
      `${prefix}: baseMigrationsHash must be sha256:<64 lowercase hex>`,
    );
  problems.push(...adrProblems(entry.adr, prefix, options.knownPaths));
  problems.push(...reviewDateProblems(entry.reviewBy, prefix, today));
  return problems;
}

export function validateMigrationBaselines(
  registry: { version?: unknown; baselines?: unknown },
  options: BaselineValidationOptions = {},
): readonly string[] {
  const problems: string[] = [...registryShapeProblems(registry, 'baselines')];
  const today = options.today ?? utcToday();
  if (!Array.isArray(registry.baselines)) return problems;
  for (const [index, value] of registry.baselines.entries()) {
    const prefix = `baselines[${index}]`;
    const shape = entryObjectProblems(value, prefix);
    if (shape.length > 0) {
      problems.push(...shape);
      continue;
    }
    problems.push(
      ...baselineProblems(value as BaselineEntry, prefix, options, today),
    );
  }
  return problems;
}
