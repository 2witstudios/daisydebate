import { assert, setupRitewayBun, test } from 'riteway/bun';
import { pureDatabaseModuleIssue } from './database-decisions';

setupRitewayBun();

const decision = [
  "import { createAppError } from '@daisy/errors';",
  'export function requireOpenRound(status: string) {',
  "  if (status !== 'live') throw createAppError('CONFLICT');",
  '}',
].join('\n');

const issueOf = (path: string, source: string) =>
  pureDatabaseModuleIssue(path, source) !== null;

test('refuses a pure decision file added to packages/db', () => {
  assert({
    given: 'a packages/db module that exports a decision and loads no storage',
    should: 'report it',
    actual: issueOf('packages/db/src/round-open-rule.ts', decision),
    expected: true,
  });
});

test('refuses every spelling of an exported function', () => {
  const spellings = [
    'export const isOpen = (status: string) => status === "live";',
    'export const isOpen = function (status: string) { return true; };',
    'const isOpen = (status: string) => status === "live";\nexport { isOpen };',
    'function isOpen() { return true; }\nexport { isOpen as roundIsOpen };',
    'export class OpenRule { check() { return true; } }',
    'export const Rules = { isOpen: (status: string) => status === "live" };',
    'export const Rules = { isOpen() { return true; } };',
    'export default (status: string) => status === "live";',
    'export const isOpen = ((status: string) => true) satisfies unknown;',
  ];
  assert({
    given: 'each spelling of an exported function in a pure module',
    should: 'report each one',
    actual: spellings.map((source) =>
      issueOf('packages/db/src/rule.ts', source),
    ),
    expected: spellings.map(() => true),
  });
});

test('accepts a module that touches storage by any primitive', () => {
  const primitives = [
    "import { sql } from 'drizzle-orm';",
    "import type { SQL } from 'bun';",
    "import { rounds } from './schema/rounds';",
    "import type { Tx } from './tx.ts';",
    "import { query } from './raw-rows';",
    "import type { BoundedTransaction } from './bounded-transaction';",
    "import type { Lane } from './workload';",
    "type Pool = import('bun').SQL;",
  ];
  assert({
    given: 'a decision beside each storage primitive it loads',
    should: 'report none',
    actual: primitives.map((line) =>
      issueOf('packages/db/src/round-store.ts', `${line}\n${decision}`),
    ),
    expected: primitives.map(() => false),
  });
});

test('does not count a look-alike module as storage', () => {
  const lookalikes = [
    "import { x } from './schema-names';",
    "import { x } from './tx-digest';",
    "import { x } from './raw-rows-format';",
    "import { x } from '@daisy/db/tab';",
    "const name = 'drizzle-orm';",
  ];
  assert({
    given: 'imports whose names resemble a storage primitive',
    should: 'still report the pure module',
    actual: lookalikes.map((line) =>
      issueOf('packages/db/src/rule.ts', `${line}\n${decision}`),
    ),
    expected: lookalikes.map(() => true),
  });
});

test('reads only production modules of packages/db that export a function', () => {
  assert({
    given: 'tests, test support, schema, data, types and other packages',
    should: 'report none of them',
    actual: [
      issueOf('packages/db/src/round-open-rule.test.ts', decision),
      issueOf('packages/db/src/round.test-support.ts', decision),
      issueOf('packages/db/src/schema/rounds.ts', decision),
      issueOf('packages/db/integration/round.integration.ts', decision),
      issueOf('packages/protocol/src/round.ts', decision),
      issueOf('packages/db/src/formats.ts', 'export const formats = [1, 2];'),
      issueOf('packages/db/src/types.ts', 'export type Rule = () => void;'),
      issueOf(
        'packages/db/src/entry.ts',
        "export { requireOpenRound } from './round-open-rule';",
      ),
    ],
    expected: [false, false, false, false, false, false, false, false],
  });
});
