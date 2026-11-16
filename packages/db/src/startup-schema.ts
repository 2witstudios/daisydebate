import { readMigrationFiles } from 'drizzle-orm/migrator';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  tenantIsolationProblems,
  type TenantTableFacts,
} from './tenant-isolation';
import type { TenantIsolationManifest } from './tenant-isolation-manifest';

export type MigrationStamp = {
  readonly hash: string;
  readonly createdAt: number;
};
export type ImageSchema = {
  readonly migrations: readonly MigrationStamp[];
  readonly tables: ReadonlyArray<{
    readonly table: string;
    readonly columns: readonly string[];
  }>;
};

/** Only an intact image-history prefix followed by newer folders witnesses an ahead database. */
export const startupSchemaProblems = ({
  image,
  journal,
  facts,
  manifest,
}: {
  readonly image: ImageSchema;
  readonly journal: readonly MigrationStamp[];
  readonly facts: readonly TenantTableFacts[];
  readonly manifest: TenantIsolationManifest;
}): readonly string[] => {
  const historyMatches =
    image.migrations.length > 0 &&
    image.migrations.every(
      (stamp, index) =>
        stamp.hash === journal[index]?.hash &&
        stamp.createdAt === journal[index]?.createdAt,
    ) &&
    journal.every(
      (stamp, index) =>
        Number.isSafeInteger(stamp.createdAt) &&
        /^[a-f0-9]{64}$/.test(stamp.hash) &&
        (index === 0 || stamp.createdAt > journal[index - 1]!.createdAt),
    );
  const ahead = historyMatches && journal.length > image.migrations.length;
  const byName = new Map(facts.map((table) => [table.table, table]));
  const imageTables = new Set(image.tables.map(({ table }) => table));
  return [
    ...(historyMatches
      ? []
      : ['Database migration history does not extend this image']),
    ...image.tables.flatMap(({ table, columns }) => {
      const found = byName.get(table);
      return found === undefined
        ? [`${table} is required by this image but does not exist`]
        : columns
            .filter(
              (name) => !found.columns.some((column) => column.name === name),
            )
            .map(
              (name) =>
                `${table}.${name} is required by this image but does not exist`,
            );
    }),
    // A later migration may add objects this image cannot name. It may not
    // remove a used column or weaken any fence declared by this image.
    ...tenantIsolationProblems(
      ahead ? facts.filter(({ table }) => imageTables.has(table)) : facts,
      manifest,
    ),
  ];
};

/** The migration SQL and latest generated snapshot shipped in this image. */
export const readImageSchema = async (): Promise<ImageSchema> => {
  const folder = join(dirname(fileURLToPath(import.meta.url)), '../migrations');
  const migrations = readMigrationFiles({ migrationsFolder: folder });
  const last = migrations.at(-1);
  if (!last) throw new Error('Image migrations are missing');
  const snapshot = JSON.parse(
    await readFile(`${folder}/${last.name}/snapshot.json`, 'utf8'),
  ) as {
    readonly ddl: ReadonlyArray<{
      readonly entityType: string;
      readonly schema: string;
      readonly name: string;
      readonly table?: string;
    }>;
  };
  return {
    migrations: migrations.map(({ hash, folderMillis }) => ({
      hash,
      createdAt: folderMillis,
    })),
    tables: snapshot.ddl
      .filter(
        (entry) => entry.entityType === 'tables' && entry.schema === 'public',
      )
      .map(({ name }) => ({
        table: name,
        columns: snapshot.ddl
          .filter(
            (entry) =>
              entry.entityType === 'columns' &&
              entry.schema === 'public' &&
              entry.table === name,
          )
          .map(({ name }) => name),
      })),
  };
};
