import { migrationFolders } from './check-migrations';

type MigrationIdentity = { readonly from: string; readonly to: string };
type Source = { readonly path: string; readonly text: string };
const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Resolve original spans once, with qualified identities taking precedence. */
export function pendingMigrationReferences(
  identities: readonly MigrationIdentity[],
  sources: readonly Source[],
) {
  const qualified = new Map<string, string>();
  const bare = new Map<string, Set<string>>();
  const problems = new Set<string>();
  for (const { from, to } of identities) {
    if (qualified.has(from) && qualified.get(from) !== to)
      problems.add(`Ambiguous migration identity ${from}`);
    qualified.set(from, to);
    const tag = from.split('/').at(-1)!;
    const choices = bare.get(tag) ?? new Set<string>();
    choices.add(to.split('/').at(-1)!);
    bare.set(tag, choices);
  }
  const tag = '\\d{14}_[a-z0-9_]+';
  const token = new RegExp(
    `(?<![A-Za-z0-9_])(?:(?:${migrationFolders.map(escaped).join('|')})/${tag}|(?<!/)${tag})(?![A-Za-z0-9_])`,
    'g',
  );
  const updates: { path: string; before: string; after: string }[] = [];
  for (const { path, text } of sources) {
    const after = text.replace(token, (original) => {
      if (original.includes('/')) return qualified.get(original) ?? original;
      const choices = bare.get(original);
      if (!choices) return original;
      if (choices.size !== 1) {
        problems.add(
          `${path}: ambiguous migration identity ${original}; qualify its database path`,
        );
        return original;
      }
      return [...choices][0]!;
    });
    if (after !== text) updates.push({ path, before: text, after });
  }
  return { updates, problems: [...problems] };
}
