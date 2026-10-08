import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';

/**
 * The constraint and index names the schema suites and their negative
 * controls refer to (ADR 0029, ADR 0058). A renamed rule fails here before
 * it fails against PostgreSQL.
 */
export const schemaRules = (table: PgTable) => {
  const config = getTableConfig(table);
  return {
    checks: config.checks.map((check) => check.name).sort(),
    indexes: config.indexes
      .map(
        (index) =>
          `${index.config.unique ? 'unique ' : ''}${index.config.name}`,
      )
      .sort(),
    uniques: config.uniqueConstraints.map((unique) => unique.name).sort(),
    // Only explicitly named keys: drizzle-orm 1.0's `getName()` default
    // (`…_fk`) differs from the `…_fkey` name drizzle-kit 1.0 generates, so
    // default names are checked against PostgreSQL in
    // integration/baseline.integration.ts instead.
    namedKeys: config.foreignKeys
      .map((key) => key.reference().name)
      .filter((name): name is string => name !== undefined)
      .sort(),
  };
};
