// The greenfield baseline registry (`policy/migration-baselines.json`): a
// sanctioned history rewrite of the shared migration chain, recorded with the
// baseline folder, the cut-off it replaces through, the fingerprint of the
// folders it superseded and a date to be judged by (ADR 0913). ADR 0038 defines what a
// baseline is; docs/architecture/rules.md makes it the only sanctioned way to rewrite applied
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
  readonly tag: string;
  readonly cutoff: string;
  readonly commit: string;
  readonly supersededHash: string;
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
      'tag',
      'cutoff',
      'commit',
      'supersededHash',
      'adr',
      'owner',
      'reason',
      'reviewBy',
    ]),
  );
  const formats = [
    ['tag', /^\d{14}_baseline$/, '<14-digit timestamp>_baseline'],
    ['cutoff', /^\d{14}_[a-z0-9_]+$/, 'a migration folder name'],
    ['commit', /^[0-9a-f]{40}$/, 'a full commit id'],
    ['supersededHash', /^sha256:[0-9a-f]{64}$/, 'sha256:<64 lowercase hex>'],
  ] as const;
  for (const [field, pattern, shape] of formats) {
    const value = entry[field];
    if (typeof value === 'string' && !pattern.test(value))
      problems.push(`${prefix}: ${field} must be ${shape}`);
  }
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
