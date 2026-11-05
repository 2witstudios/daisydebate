import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { flagCatalogue } from '../apps/web/src/features/flags/catalogue';
import { catalogueProblems } from '../apps/web/src/features/flags/catalogue-validation';
import type { FlagDefinition } from '../apps/web/src/features/flags/model';
import { utcToday } from './review-date';

type FlagIdentity = {
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
  for (const old of previous.keys) {
    if (JSON.stringify(identities.get(old.key)) !== JSON.stringify(old))
      problems.push(`changed or removed flag identity: ${old.key}`);
  }
  for (const entry of catalogue) {
    const identity = identities.get(entry.key);
    if (
      !identity ||
      identity.kind !== entry.kind ||
      identity.owner !== entry.owner ||
      identity.taskCode !== entry.taskCode
    )
      problems.push(`unregistered or reused key: ${entry.key}`);
    if (entry.expiresOn < today)
      problems.push(`expired ${entry.kind} flag: ${entry.key}`);
  }
  // A key absent from the base catalogue is retired once its ledger entry exists.
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
