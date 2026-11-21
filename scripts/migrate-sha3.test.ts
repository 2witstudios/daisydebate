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
