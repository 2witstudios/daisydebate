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

test('accepts a module that reads a storage primitive by any of them', () => {
  const uses = [
    "import { sql } from 'drizzle-orm';\nexport const filter = sql`true`;",
    "import { SQL } from 'bun';\nexport const pool = () => new SQL('x');",
    "import { rounds } from './schema/rounds';\nexport const table = () => rounds;",
    "import * as schema from './schema/rounds';\nexport const table = () => schema.rounds;",
    "import { inTransaction } from './tx.ts';\nexport const open = inTransaction;",
    "import { query } from './raw-rows';\nexport const read = () => query;",
    "import { createBoundedTransaction } from './bounded-transaction';\nexport const runner = createBoundedTransaction;",
    "import { createWorkload } from './workload';\nexport const lanes = createWorkload;",
    "import { resourcesOf } from './resource-handles';\nexport const lanes = (resources: object) => resourcesOf(resources);",
  ];
  assert({
    given: 'a decision beside each storage primitive it reads as a value',
    should: 'report none',
    actual: uses.map((source) =>
      issueOf('packages/db/src/round-store.ts', `${source}\n${decision}`),
    ),
    expected: uses.map(() => false),
  });
});

test('accepts a function that takes and uses a transaction, connection or runner', () => {
  const typed = [
    "import type { Tx } from './tx';\nexport const lock = (tx: Tx) => tx.execute(1);",
    "import type { SQL } from 'bun';\nexport async function read(client: SQL) { return client.unsafe('x'); }",
    "import type { BoundedTransaction } from './bounded-transaction';\nexport const store = ({ run }: { readonly run: BoundedTransaction }) => ({ go: () => run(async () => 1) });",
    "export const read = (client: import('bun').SQL) => client.unsafe('x');",
    "import type { SQL } from 'bun';\ntype Opener = { readonly pool: SQL };\nexport const open = (opener: Opener) => opener.pool;",
    "import type { DatabaseResources } from './resources';\nexport const store = (resources: DatabaseResources) => ({ close: resources.close });",
  ];
  assert({
    given:
      'a function whose parameter a storage primitive types, and that uses it',
    should: 'report none',
    actual: typed.map((source) =>
      issueOf('packages/db/src/round-store.ts', source),
    ),
    expected: typed.map(() => false),
  });
});

test('refuses a pure decision dressed with a type-only or unused storage import', () => {
  const dressed = [
    "import type { Tx } from './tx';",
    "import { type Tx } from './tx';",
    "import type { rounds } from './schema/rounds';\ntype Row = typeof rounds.$inferSelect;",
    "import type { SQL } from 'bun';\ntype Failure = Pick<SQL.PostgresError, 'errno'>;",
    "import { sql } from 'drizzle-orm';",
    "import { rounds } from './schema/rounds';\ntype Row = typeof rounds.$inferSelect;",
    "import type { Tx } from './tx';\nexport const ignore = (tx: Tx, status: string) => status === 'live';",
    "export { query } from './raw-rows';",
    "import type { WorkloadLane } from './workload';\nexport const isBusy = (lane: WorkloadLane) => lane === 'social';",
    "type Facts = { readonly status: string };\nexport const check = (facts: Facts) => facts.status === 'live';",
    "import type { DatabaseResources } from './resources';\nexport const ignore = (resources: DatabaseResources, status: string) => status === 'live';",
    "import { namedLaneOperations } from './instrumented';\nexport const named = namedLaneOperations;",
  ];
  assert({
    given:
      'a decision beside a type-only, unused or re-exported primitive, or a typed parameter it never uses',
    should: 'report each one',
    actual: dressed.map((line) =>
      issueOf('packages/db/src/rule.ts', `${line}\n${decision}`),
    ),
    expected: dressed.map(() => true),
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

test('counts a schema object as storage, never a vocabulary constant beside it', () => {
  const schema = [
    "import { pgEnum, pgTable, text } from 'drizzle-orm/pg-core';",
    "export const privacyVendors = ['posthog', 'stripe'] as const;",
    "export const privacyJobs = pgTable('privacy_jobs', { id: text('id') });",
    "export const guarded = pgTable('guarded', { id: text('id') }).enableRLS();",
    "export const jobStatus = pgEnum('job_status', ['pending']);",
  ].join('\n');
  const read = (path: string) =>
    path === 'packages/db/src/schema/privacy-jobs.ts' ? schema : undefined;
  const issue = (source: string) =>
    pureDatabaseModuleIssue('packages/db/src/privacy/plan.ts', source, read) !==
    null;
  assert({
    given:
      'a module reading a schema vocabulary constant, a table, an RLS table and an enum',
    should: 'report only the one that reads the vocabulary constant',
    actual: [
      "import { privacyVendors } from '../schema/privacy-jobs';\nexport const mayErase = (vendor: string) => privacyVendors.some((known) => known === vendor);",
      "import { privacyJobs } from '../schema/privacy-jobs';\nexport const table = () => privacyJobs;",
      "import { guarded } from '../schema/privacy-jobs';\nexport const table = () => guarded;",
      "import { jobStatus } from '../schema/privacy-jobs';\nexport const kind = () => jobStatus;",
    ].map(issue),
    expected: [true, false, false, false],
  });
});
