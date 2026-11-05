import type { FlagDefinition } from './model';

const isDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;

/** Also used at runtime: a broken graph never opens a gate. */
export function catalogueProblems(
  catalogue: readonly FlagDefinition[],
): readonly string[] {
  const problems: string[] = [];
  const entries = new Map(catalogue.map((entry) => [entry.key, entry]));
  if (entries.size !== catalogue.length) problems.push('duplicate key');
  if (catalogue.length > 32) problems.push('live flag cap exceeded');
  for (const entry of catalogue)
    problems.push(...definitionProblems(entry, entries));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (key: string): boolean => {
    if (visiting.has(key)) return false;
    if (visited.has(key)) return true;
    visiting.add(key);
    if (!(entries.get(key)?.dependencies ?? []).every(visit)) return false;
    visiting.delete(key);
    visited.add(key);
    return true;
  };
  if (![...entries.keys()].every(visit)) problems.push('dependency cycle');
  return problems;
}

function definitionProblems(
  entry: FlagDefinition,
  entries: ReadonlyMap<string, FlagDefinition>,
): string[] {
  const problems: string[] = [];
  if (
    !/^[a-z][a-z0-9-]{1,63}$/.test(entry.key) ||
    !entry.owner.trim() ||
    !/^[A-Z]+-\d+(?:[.\w-]+)?$/.test(entry.taskCode) ||
    !isDate(entry.expiresOn)
  )
    problems.push('invalid definition');
  if (entry.kind === 'release' && entry.safeDefault !== false)
    problems.push('release must fail closed');
  if (new Set(entry.dependencies).size !== entry.dependencies.length)
    problems.push('duplicate dependency');
  if (entry.dependencies.some((key) => !entries.has(key)))
    problems.push('unknown dependency');
  return problems;
}
