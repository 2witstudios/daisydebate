import { expect } from 'bun:test';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  migrateProtocolSubpaths,
  protocolOwners,
} from './migrate-protocol-subpaths';

setupRitewayBun();

const owners = protocolOwners(`
export { value, detail, type Detail } from './round';
export type { Rule } from './format';
`);
const subpaths = {
  './round': './src/round.ts',
  './format': './src/format.ts',
};
const migrate = (source: string, path = 'apps/web/example.ts') =>
  migrateProtocolSubpaths(path, source, owners, subpaths);

test('moves mixed declarations and retains aliases and type qualifiers', () => {
  const source = `// Root import with mixed bindings.
import { value as local, type Rule, type Detail } from '@daisy/protocol';
import type { Detail as D, Rule as R } from '@daisy/protocol';
export { value as publicValue, type Rule as PublicRule } from '@daisy/protocol';
export type { Detail as PublicDetail, Rule } from '@daisy/protocol';
type Query = typeof import('@daisy/protocol').detail.parse;
const { value: loaded, detail } = await import('@daisy/protocol');
const packageName = '@daisy/protocol';
`;
  const expected = `// Root import with mixed bindings.
import { value as local, type Detail } from '@daisy/protocol/round';
import { type Rule } from '@daisy/protocol/format';
import type { Detail as D } from '@daisy/protocol/round';
import type { Rule as R } from '@daisy/protocol/format';
export { value as publicValue } from '@daisy/protocol/round';
export { type Rule as PublicRule } from '@daisy/protocol/format';
export type { Detail as PublicDetail } from '@daisy/protocol/round';
export type { Rule } from '@daisy/protocol/format';
type Query = typeof import('@daisy/protocol/round').detail.parse;
const { value: loaded, detail } = await import('@daisy/protocol/round');
const packageName = '@daisy/protocol';
`;
  const migrated = migrate(source);
  assert({
    given: 'named bindings and a qualified type query from the former root',
    should:
      'keep local names, exported names, type qualifiers and ordinary strings',
    actual: migrated,
    expected,
  });
  assert({
    given: 'a migrated file',
    should: 'produce no edits on a second run',
    actual: migrate(migrated),
    expected: migrated,
  });
});

test('moves the internal barrel import to the relative owner module', () => {
  assert({
    given: 'a protocol test reaching the former barrel from a subdirectory',
    should: 'use the relative owner module',
    actual: migrate(
      "import { value } from '../index';",
      'packages/protocol/src/round/events.test.ts',
    ),
    expected: "import { value } from '../round';",
  });
});

test('reports a namespace import for explicit migration', () => {
  expect(() => migrate("import * as protocol from '@daisy/protocol';")).toThrow(
    'apps/web/example.ts:1: use named protocol imports or re-exports',
  );
});
