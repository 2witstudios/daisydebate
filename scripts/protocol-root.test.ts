import { expect } from 'bun:test';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  protocolRootExportIssue,
  protocolRootReferences,
} from './protocol-root';

setupRitewayBun();

test('detects protocol root imports across module syntaxes', () => {
  const source = [
    "import { value } from '@daisy/protocol';",
    "export type { Rule } from '@daisy/protocol';",
    "type Rule = import('@daisy/protocol').Rule;",
    "import protocol = require('@daisy/protocol');",
    "const root = require('@daisy/protocol');",
    'await import(`@daisy/protocol`);',
    "await import('@daisy/\\u0070rotocol');",
    "import './index.js';",
    "import { value } from '@daisy/protocol/round';",
    "const transpilePackages = ['@daisy/protocol'];",
  ].join('\n');
  assert({
    given: 'root references, a valid subpath and a package name used as data',
    should: 'report each root reference',
    actual: protocolRootReferences(
      'packages/protocol/src/example.ts',
      source,
    ).map(({ specifier }) => specifier.text),
    expected: [...Array(7).fill('@daisy/protocol'), './index.js'],
  });
});

test('allows public subpaths and rejects explicit or shorthand root exports', () => {
  const rootIssue =
    '@daisy/protocol: package exports must contain only owner subpaths';
  assert({
    given: 'a subpath export map and the supported forms of the root export',
    should: 'reject root export forms',
    actual: [
      protocolRootExportIssue({ './round': './src/round.ts' }),
      protocolRootExportIssue({ '.': './src/index.ts' }),
      protocolRootExportIssue('./src/index.ts'),
      protocolRootExportIssue({ import: './src/index.ts' }),
      protocolRootExportIssue(['./src/index.ts']),
    ],
    expected: [null, rootIssue, rootIssue, rootIssue, rootIssue],
  });
});

test('resolves an owner subpath and rejects the package root at runtime', () => {
  assert({
    given: 'the installed workspace package',
    should: 'resolve the round owner module',
    actual: Bun.resolveSync('@daisy/protocol/round', import.meta.dir).endsWith(
      '/packages/protocol/src/round.ts',
    ),
    expected: true,
  });
  expect(() => Bun.resolveSync('@daisy/protocol', import.meta.dir)).toThrow(
    "Cannot find package '@daisy/protocol'",
  );
});
