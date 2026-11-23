#!/usr/bin/env bun
/**
 * The route net (RECON-4.6): every Next route module under `src/app`, as
 * the path Next serves it at, the HTTP methods it exports and its segment
 * config. `bun run scripts/route-table.ts` rewrites `route-table.json`;
 * `route-table.test.ts` fails while it is stale and while any bound
 * handler does not resolve on a test app.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';

const appDirectory = path.join(import.meta.dir, '../src/app');
export const TABLE = path.join(import.meta.dir, 'route-table.json');

const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

export type RouteRow = {
  readonly path: string;
  readonly methods: readonly string[];
  readonly runtime: string | null;
  readonly config: Readonly<Record<string, unknown>>;
};

/** Each route module's file, relative to `src/app`, sorted. */
export const routeFiles = (): string[] =>
  (readdirSync(appDirectory, { recursive: true }) as string[])
    .filter((file) => /(^|\/)route\.ts$/.test(file))
    .sort();

/** The URL path Next serves a route file at: groups and slots dropped. */
export const servedPath = (file: string): string =>
  `/${file}`
    .replace(/\/route\.ts$/, '')
    .split('/')
    .filter((segment) => !/^\(.*\)$/.test(segment) && !segment.startsWith('@'))
    .join('/') || '/';

export const routeModule = (file: string) =>
  import(path.join(appDirectory, file)) as Promise<Record<string, unknown>>;

/** One module's row: its methods and every other export's value. */
export const routeRow = (
  file: string,
  module: Record<string, unknown>,
): RouteRow => {
  const names = Object.keys(module).sort();
  const config = Object.fromEntries(
    names
      .filter((name) => !METHODS.includes(name) && name !== 'runtime')
      .map((name) => [
        name,
        typeof module[name] === 'function' ? 'function' : module[name],
      ]),
  );
  return {
    path: servedPath(file),
    methods: names.filter((name) => METHODS.includes(name)),
    runtime: typeof module.runtime === 'string' ? module.runtime : null,
    config,
  };
};

export const routeTable = async (): Promise<RouteRow[]> =>
  (
    await Promise.all(
      routeFiles().map(async (file) => routeRow(file, await routeModule(file))),
    )
  ).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

export const renderTable = (rows: readonly RouteRow[]) =>
  `${JSON.stringify(rows, null, 2)}\n`;

if (import.meta.main) {
  await Bun.write(TABLE, renderTable(await routeTable()));
  process.stdout.write(`wrote ${path.relative(process.cwd(), TABLE)}\n`);
}
