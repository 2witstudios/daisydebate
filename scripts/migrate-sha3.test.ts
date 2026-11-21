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
