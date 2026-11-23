import { catalogFormats } from './catalog-formats';
import { referenceFormats, referencePresets } from './reference-formats';

/** Every committed migration's SQL, concatenated in folder order. */
export const committedMigrationSql = async () => {
  const directory = new URL('../migrations/', import.meta.url).pathname;
  const folders = [...new Bun.Glob('*/migration.sql').scanSync(directory)]
    .map((path) => path.split('/')[0]!)
    .sort();
  return (
    await Promise.all(
      folders.map((folder) =>
        Bun.file(`${directory}${folder}/migration.sql`).text(),
      ),
    )
  ).join('\n');
};

/** Every format the migrations seed: the reference rows, then the catalog (FMT-2a). */
export const seededFormats = [
  ...referenceFormats.map(({ id, name, revisions }) => ({
    id,
    name,
    revisions,
  })),
  ...catalogFormats.map(({ id, name, definition }) => ({
    id,
    name,
    revisions: [definition],
  })),
];
export const seededPresets = [
  ...referencePresets,
  ...catalogFormats.map(({ id, preset }) => ({
    formatId: id,
    version: 1,
    formatVersion: 1,
    config: preset,
  })),
];

/** Presets in one canonical order: the catalog lands across migrations (FMT-2a, FMT-2b). */
export const canonicalPresets = <
  T extends {
    formatId: string;
    version: number;
    formatVersion: number;
    config: unknown;
  },
>(
  presets: readonly T[],
) =>
  presets
    .map(({ formatId, version, formatVersion, config }) => ({
      formatId,
      version,
      formatVersion,
      config,
    }))
    .sort((a, b) =>
      `${a.formatId}@${a.version}`.localeCompare(`${b.formatId}@${b.version}`),
    );

/**
 * The newest committed definition of function `public.<name>`, as its
 * statement and its body (the text between its dollar quotes, which
 * PostgreSQL stores and `pg_dump` writes back verbatim, whatever tag
 * quotes it). Undefined when no folder defines it.
 */
export const installedFunction = (sql: string, name: string) => {
  const header = new RegExp(
    `CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`,
    'gi',
  );
  const last = [...sql.matchAll(header)].at(-1);
  if (!last) return undefined;
  const quote = /\$([A-Za-z_]*)\$/g;
  quote.lastIndex = last.index;
  const open = quote.exec(sql);
  if (!open) return undefined;
  const close = sql.indexOf(open[0], open.index + open[0].length);
  if (close === -1) return undefined;
  return {
    statement: sql.slice(last.index, close + open[0].length),
    body: sql.slice(open.index + open[0].length, close),
  };
};
