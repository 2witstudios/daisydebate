import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { flagCatalogue } from '../apps/web/src/features/flags/catalogue';
import { catalogueProblems } from '../apps/web/src/features/flags/catalogue-validation';
import type { FlagDefinition } from '../apps/web/src/features/flags/model';
import { utcToday } from './review-date';

type FlagIdentity = {
  readonly retired: boolean;
  readonly key: string;
  readonly kind: string;
  readonly owner: string;
  readonly taskCode: string;
};
type FlagLedger = {
  readonly version: 1;
  readonly keys: readonly FlagIdentity[];
};

/** Retiring a flag removes its catalogue entry, never its permanent key identity. */
export function flagPolicyProblems(
  catalogue: readonly FlagDefinition[],
  ledger: FlagLedger,
  previous: FlagLedger,
  today: string,
): readonly string[] {
  const problems = [...catalogueProblems(catalogue)];
  const identities = new Map(ledger.keys.map((entry) => [entry.key, entry]));
  if (ledger.version !== 1 || identities.size !== ledger.keys.length)
    problems.push('invalid key ledger');
  problems.push(...historyProblems(identities, previous));
  for (const entry of catalogue) {
    const identity = identities.get(entry.key);
    if (
      !identity ||
      identity.retired ||
      identity.kind !== entry.kind ||
      identity.owner !== entry.owner ||
      identity.taskCode !== entry.taskCode
    )
      problems.push(`unregistered or reused key: ${entry.key}`);
    if (entry.expiresOn < today)
      problems.push(`expired ${entry.kind} flag: ${entry.key}`);
  }
  for (const identity of ledger.keys) {
    if (
      typeof identity.retired !== 'boolean' ||
      (!identity.retired &&
        !catalogue.some((entry) => entry.key === identity.key))
    )
      problems.push(`removed key must be retired: ${identity.key}`);
  }
  return problems.map((problem) => `flags: ${problem}`);
}

/** Compare to the merge base so a retired key cannot be silently introduced again. */
export async function collectFlagPolicyProblems(): Promise<readonly string[]> {
  const path = 'policy/flag-keys.json';
  const ledger = JSON.parse(await readFile(path, 'utf8')) as FlagLedger;
  const base = spawnSync('git', ['merge-base', 'HEAD', 'origin/main'], {
    encoding: 'utf8',
  });
  if (base.status !== 0) return ['flags: cannot inspect key history'];
  const old = spawnSync('git', ['show', `${base.stdout.trim()}:${path}`], {
    encoding: 'utf8',
  });
  const previous: FlagLedger =
    old.status === 0
      ? (JSON.parse(old.stdout) as FlagLedger)
      : { version: 1, keys: [] };
  return flagPolicyProblems(flagCatalogue, ledger, previous, utcToday());
}

function historyProblems(
  identities: ReadonlyMap<string, FlagIdentity>,
  previous: FlagLedger,
) {
  const problems: string[] = [];
  for (const old of previous.keys) {
    const next = identities.get(old.key);
    if (
      !next ||
      next.kind !== old.kind ||
      next.owner !== old.owner ||
      next.taskCode !== old.taskCode ||
      (old.retired && !next.retired)
    )
      problems.push(`changed or removed flag identity: ${old.key}`);
  }
  return problems;
}
