import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { migrateSha3 } from './migrate-sha3';

setupRitewayBun();

describe('the SHA3-256 migration', () => {
  test('reuses a digest import when migrating an added call', () => {
    const source = [
      "'use client';",
      "import { sha3Hex as digest } from '@daisy/digest';",
      "import { createHash, createHmac } from 'node:crypto';",
      "export const earlier = digest('earlier');",
      "export const added = createHash('sha3-256').update('added').digest('hex');",
      "export const sign = () => createHmac('sha256', 'key');",
    ];
    const migrated = migrateSha3('example.ts', source.join('\n'));
    const expected = [
      "'use client';",
      "import { sha3Hex as digest } from '@daisy/digest';",
      "import { createHmac } from 'node:crypto';",
      "export const earlier = digest('earlier');",
      "export const added = digest('added');",
      "export const sign = () => createHmac('sha256', 'key');",
    ].join('\n');

    assert({
      given:
        'an extra native SHA3-256 call in a module that already imports the helper',
      should:
        'reuse that alias, preserve the directive and keep the HMAC import',
      actual: [migrated, migrateSha3('example.ts', migrated)],
      expected: [expected, expected],
    });
  });
});

test('migrates nested constructors in one pass', () => {
  const source = [
    "import { createHash } from 'node:crypto';",
    "export const nested = createHash('sha3-256').update(createHash('sha3-256').update('nested').digest('hex')).digest('hex');",
  ].join('\n');
  const expected = [
    "import { sha3Hex } from '@daisy/digest';",
    "export const nested = sha3Hex(sha3Hex('nested'));",
  ].join('\n');
  const migrated = migrateSha3('example.ts', source);
  assert({
    given: 'a SHA3 constructor inside another SHA3 payload',
    should: 'rewrite both calls and remove the unused import in a single pass',
    actual: [migrated, migrateSha3('example.ts', migrated)],
    expected: [expected, expected],
  });
});

test('uses native bindings and an unshadowed shared alias', () => {
  const source = [
    "import { sha3Hex as digest } from '@daisy/digest';",
    "import { createHash } from 'node:crypto';",
    "export const existing = digest('existing');",
    "export function native(digest: Digest) { return createHash('sha3-256').update('value').digest('hex'); }",
    "export function local(createHash: Hasher) { return createHash('sha3-256').update('value').digest('hex'); }",
  ].join('\n');
  const expected = [
    "import { sha3Hex as sharedSha3Hex, sha3Hex as digest } from '@daisy/digest';",
    "export const existing = digest('existing');",
    "export function native(digest: Digest) { return sharedSha3Hex('value'); }",
    "export function local(createHash: Hasher) { return createHash('sha3-256').update('value').digest('hex'); }",
  ].join('\n');
  const migrated = migrateSha3('example.ts', source);
  assert({
    given: 'a native import, a shadowed digest alias and a local hasher',
    should: 'migrate only the native call with an unshadowed helper',
    actual: [migrated, migrateSha3('example.ts', migrated)],
    expected: [expected, expected],
  });
});

test('finds native namespace aliases and destructuring in JavaScript files', () => {
  const source = [
    "import * as crypto from 'node:crypto';",
    'const hashing = crypto;',
    'const { createHash: digest } = hashing;',
    'const native = Bun;',
    "export const results = [hashing.createHash('sha3-256').update('a').digest('hex'), digest('sha3-256').update('b').digest('hex'), new native.CryptoHasher('sha3-256').update('c').digest('hex')];",
    "export const local = (hashing) => hashing.createHash('sha3-256').update('local').digest('hex');",
  ].join('\n');
  assert({
    given:
      'native namespace aliases, destructuring and a locally supplied owner',
    should: 'rewrite only the native calls in both JavaScript module formats',
    actual: ['example.js', 'example.mjs'].map((path) =>
      migrateSha3(path, source)
        .split('\n')
        .filter((line) => line.startsWith('export ')),
    ),
    expected: ['example.js', 'example.mjs'].map(() => [
      "export const results = [sha3Hex('a'), sha3Hex('b'), sha3Hex('c')];",
      "export const local = (hashing) => hashing.createHash('sha3-256').update('local').digest('hex');",
    ]),
  });
});

test('reports native require chains without changing their module format', () => {
  const prefixes = [
    "const { createHash: hash } = require('node:crypto');",
    "const crypto = require('node:crypto'); const owner = crypto; const { createHash: hash } = owner;",
  ];
  const results = ['sample.js', 'sample.mjs', 'sample.cjs'].flatMap((path) =>
    prefixes.map((prefix) => {
      const source = `${prefix} module.exports = hash('sha3-256').update('a').digest('hex');`;
      let manual = false;
      const migrated = migrateSha3(path, source, () => {
        manual = true;
      });
      return [migrated === source, manual];
    }),
  );
  assert({
    given: 'a native require binding and an aliased require binding',
    should:
      'retain the original module syntax and report both for manual conversion',
    actual: results,
    expected: Array.from({ length: 6 }, () => [true, true]),
  });
});

test('reports export-only and split CommonJS hash construction', () => {
  const chain = "new Bun.CryptoHasher('sha3-256').update('a').digest('hex')";
  const scenarios = [
    { file: 'sample.js', source: `module.exports = ${chain};`, manual: true },
    { file: 'sample.js', source: `exports.digest = ${chain};`, manual: true },
    { file: 'sample.js', source: `(module).exports = ${chain};`, manual: true },
    { file: 'sample.js', source: `(exports).digest = ${chain};`, manual: true },
    {
      file: 'sample.cjs',
      source:
        "const { createHash } = require('node:crypto'); const digest = createHash('SHA3-256', {}); digest.update('a'); module.exports = digest.digest('hex');",
      manual: true,
    },
    {
      file: 'sample.cjs',
      source:
        "const native = require('node:crypto'); const { createHash: hash } = native; const digest = hash('sha3-256'); digest.update('a'); module.exports = digest.digest('hex');",
      manual: true,
    },
    {
      file: 'sample.js',
      source: `function publish(module) { (module).exports = ${chain}; }`,
      manual: false,
    },
  ];
  assert({
    given:
      'real CommonJS exports, a split hasher and a shadowed module parameter',
    should: 'report each actual CommonJS hash and migrate the local control',
    actual: scenarios.map(({ file, source }) => {
      let manual = false;
      const migrated = migrateSha3(file, source, () => {
        manual = true;
      });
      return [manual, migrated === source];
    }),
    expected: scenarios.map(({ manual }) => [manual, manual]),
  });
});
