import { join } from 'node:path';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  schemaProgram,
  vocabularyColumns,
} from './schema-vocabularies.test-support';

setupRitewayBun();

const packageRoot = join(import.meta.dir, '..');

test('every CHECK-constrained column carries its vocabulary type', () => {
  const { program, isSchemaFile } = schemaProgram(packageRoot);
  const columns = vocabularyColumns(program, isSchemaFile);
  assert({
    given: 'every oneOf CHECK in the schema',
    should: 'find the whole schema, not an empty walk',
    actual: columns.length >= 170,
    expected: true,
  });
  assert({
    given: 'each CHECK-constrained column and its vocabulary list',
    should: "type the column with exactly the list's union",
    actual: columns
      .filter((column) => !column.exact)
      .map(({ site, declared, vocabulary }) => ({
        site,
        declared,
        vocabulary,
      })),
    expected: [],
  });
  // Each test compiles the schema with the TypeScript checker; a slow
  // runner needs more than the default.
}, 60_000);

test('a CHECK over a column typed string is refused', () => {
  const file = join(packageRoot, 'src', 'schema', 'vocabulary-probe.ts');
  const probe = `
import { check, pgTable, text } from 'drizzle-orm/pg-core';
import { roomStatuses } from '@daisy/protocol/room-contract';
import { oneOf } from './columns';
export const untypedProbes = pgTable(
  'untyped_probes',
  { status: text('status').notNull() },
  (table) => [check('untyped_probes_status', oneOf(table.status, roomStatuses))],
);
export const typedProbes = pgTable(
  'typed_probes',
  { status: text('status').$type<(typeof roomStatuses)[number]>().notNull() },
  (table) => [check('typed_probes_status', oneOf(table.status, roomStatuses))],
);
`;
  const { program, isSchemaFile } = schemaProgram(
    packageRoot,
    new Map([[file, probe]]),
  );
  const verdict = (table: string) =>
    vocabularyColumns(program, isSchemaFile)
      .filter(({ site }) => site.endsWith(` ${table}.status`))
      .map(({ exact, role }) => ({ exact, role }));
  assert({
    given: 'a status column typed string under a Room status CHECK',
    should: 'report the column as not carrying its vocabulary',
    actual: verdict('untypedProbes'),
    expected: [{ exact: false, role: 'vocabulary' }],
  });
  assert({
    given: 'the same column typed from the Room status list',
    should: 'report it exact',
    actual: verdict('typedProbes'),
    expected: [{ exact: true, role: 'vocabulary' }],
  });
  // Each test compiles the schema with the TypeScript checker; a slow
  // runner needs more than the default.
}, 60_000);
