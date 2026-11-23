import { posix } from 'node:path';
import { moduleLoads } from './module-loads';

/**
 * R4.5: `@daisy/db` has no root. Each process opens its resources from
 * `@daisy/db/resources` and composes the area stores on `@daisy/db/stores/*`;
 * a root import, by any spelling, or a root export would bring back the one
 * object of every operation.
 */
const databasePackage = '@daisy/db';
const databaseDirectory = 'packages/db';
const databaseBarrel = `${databaseDirectory}/src/index.ts`;

export function databaseRootExportIssue(exports: unknown): string | null {
  return typeof exports === 'string' ||
    (exports !== null &&
      typeof exports === 'object' &&
      (Array.isArray(exports) ||
        Object.keys(exports).some((key) => !key.startsWith('./'))))
    ? `${databasePackage}: package exports must contain only area subpaths`
    : null;
}

function resolvesToBarrel(path: string, name: string): boolean {
  if (!name.startsWith('.')) return false;
  const target = posix
    .normalize(posix.join(posix.dirname(path), name))
    .replace(/\/$/, '')
    .replace(/\.[jt]s$/, '');
  return (
    target === `${databaseDirectory}/src/index` ||
    target === `${databaseDirectory}/src` ||
    target === databaseDirectory
  );
}

/** Every load of the database root in `source`, by any spelling the compiler reads. */
export function databaseRootReferences(path: string, source: string) {
  if (!/db|index|src|\\[ux]|['"`][.]{1,2}\/?['"`]/.test(source)) return [];
  return moduleLoads(
    path,
    source,
    (name) => name === databasePackage || resolvesToBarrel(path, name),
  );
}
