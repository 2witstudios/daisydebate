import { dirname, join, resolve } from 'node:path';

/**
 * drizzle-kit names a migration `<adjective>_<hero>` from two word lists
 * when `generate` gets no `--name` (`dark_silver_centurion`). Such a name
 * says nothing about the change, so the migration check refuses it. The
 * lists are read from the pinned drizzle-kit itself, so a name it can
 * generate is refused whatever words it draws.
 */
export type GeneratedNameWords = {
  readonly adjectives: ReadonlySet<string>;
  readonly heroes: ReadonlySet<string>;
};

const list = (source: string, name: string): ReadonlySet<string> => {
  const body = new RegExp(`\\b${name} = \\[([^\\]]*)\\]`).exec(source)?.[1];
  const words = [...(body ?? '').matchAll(/"([^"]+)"/g)].map(
    ([, word]) => word!,
  );
  if (words.length === 0)
    throw new Error(
      `drizzle-kit's ${name} word list was not found; update scripts/migration-names.ts for this drizzle-kit`,
    );
  return new Set(words);
};

/** The word lists of the drizzle-kit `@daisy/db` generates with. */
export async function readGeneratedNameWords(): Promise<GeneratedNameWords> {
  const manifest = Bun.resolveSync(
    'drizzle-kit/package.json',
    resolve(import.meta.dir, '../packages/db'),
  );
  const source = await Bun.file(join(dirname(manifest), 'cli.js')).text();
  return {
    adjectives: list(source, 'adjectives'),
    heroes: list(source, 'heroes'),
  };
}

/** Whether `tag`'s name is one drizzle-kit could have drawn for it. */
export const isGeneratedName = (
  tag: string,
  { adjectives, heroes }: GeneratedNameWords,
): boolean => {
  const name = tag.slice(15);
  return [...adjectives].some(
    (adjective) =>
      name.startsWith(`${adjective}_`) &&
      heroes.has(name.slice(adjective.length + 1)),
  );
};
