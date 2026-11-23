import { dirname, join, resolve } from 'node:path';

/**
 * drizzle-kit names a migration `<adjective>_<hero>` from two word lists
 * when `generate` gets no `--name` (`dark_silver_centurion`). Such a name
 * says nothing about the change, so the migration check refuses it,
 * whatever words drizzle-kit draws.
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
export async function readPinnedDrizzleKitWords(): Promise<GeneratedNameWords> {
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

/**
 * The committed copy of those lists, which the check reads so it runs
 * without installed dependencies; `migration-names.test.ts` fails when the
 * copy and the pinned drizzle-kit differ.
 */
export async function readGeneratedNameWords(): Promise<GeneratedNameWords> {
  const words = (await Bun.file(
    join(import.meta.dir, 'migration-name-words.json'),
  ).json()) as { adjectives: string[]; heroes: string[] };
  return {
    adjectives: new Set(words.adjectives),
    heroes: new Set(words.heroes),
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
