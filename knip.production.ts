// The second pass of `bun run knip`: what a deployed web app reaches, and a
// required check (ADR 0057 decision 8). Tests are no entries here, so a module
// only its own test imports is reported (ISSUE-1006). `--production` reads only
// the `!` patterns.
//
// An unwired foundation is not ignored here: it is declared in
// `policy/planned-readers.json` with the task that will read it and a date, and
// every `apps/web` module with a declared export is an entry of this pass, so
// what it imports is reached too. `bun policy` fails that declaration once its
// reader appears.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { KnipConfig } from 'knip';

const web = 'apps/web/';
const registry = JSON.parse(
  readFileSync(
    join(import.meta.dirname, 'policy/planned-readers.json'),
    'utf8',
  ),
) as { readonly readers: readonly { readonly path: string }[] };

/** Every web module the registry declares an export of, as a production entry. */
const declared = [
  ...new Set(
    registry.readers
      .map((reader) => reader.path)
      .filter((path) => path.startsWith(web))
      .map((path) => `${path.slice(web.length)}!`),
  ),
].sort();

const config: KnipConfig = {
  workspaces: {
    'apps/web': {
      entry: declared,
      // The start script is classified as a development entry by Knip's
      // script parser. The Next plugin also reads routes from next.config.ts.
      next: { entry: ['src/server/start.ts'] },
      project: [
        'src/**/*.{ts,tsx}!',
        '!src/**/*.test.{ts,tsx}!',
        '!src/**/*.test-support.{ts,tsx}!',
        '!src/**/test-support/**!',
        '!src/lib/testing/**!',
      ],
    },
  },
};

export default config;
