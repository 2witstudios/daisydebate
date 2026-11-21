import { assert, describe, test } from 'riteway/bun';
import { repositoryEslint } from './eslint.config.test-support';

export function registerClockDigestTests() {
  describe('shared instant and SHA3-256 helpers', () => {
    const lint = async (filePath: string, code: string) => {
      const [result] = await repositoryEslint().lintText(code, { filePath });
      return result!.messages
        .filter(({ ruleId }) => ruleId?.startsWith('clock-digest/'))
        .map(({ ruleId }) => ruleId);
    };

    test('rejects Date parsing expressions and aliases outside the clock package', async () => {
      const old = [
        "const ms = Date.parse('2026-11-20T00:00:00Z');",
        'const fn = globalThis.Date[`parse`];',
        'const indexed = Date["parse"];',
        'const { parse: alias } = Date;',
        'const DateAlias = Date, another = DateAlias;',
        'export const indirect = another.parse(input);',
        'export { ms, fn, indexed, alias };',
      ].join('\n');
      assert({
        given:
          'the old Date members in production or integration sources and in the clock implementation',
        should: 'reject all old uses outside the clock package',
        actual: await Promise.all([
          lint('packages/protocol/src/instant-probe.ts', old),
          lint('apps/web/integration/instant-probe.ts', old),
          lint('packages/clock/src/instant-probe.ts', old),
        ]),
        expected: [
          Array<string>(5).fill('clock-digest/iso-instant'),
          Array<string>(5).fill('clock-digest/iso-instant'),
          [],
        ],
      });
    });

    test('rejects duplicated SHA3-256 constructions and leaves other algorithms alone', async () => {
      const old = [
        "import { createHash as makeHash } from 'node:crypto';",
        "import { sha3_256 } from '@noble/hashes/sha3.js';",
        "const algorithm = 'sha3-256', indirect = algorithm;",
        "const sha256 = 'sha256';",
        'export const hashes = [',
        "  makeHash(`sha3-256`), new Bun.CryptoHasher('sha3-256'), ",
        '  makeHash(sha256), makeHash(indirect), sha3_256(new Uint8Array()),',
        '];',
      ].join('\n');
      assert({
        given:
          'two native SHA3-256 hashers, a direct SHA3 import and an intentional SHA-256 hash',
        should: 'allow SHA3 implementation only in the digest package',
        actual: await Promise.all([
          lint('packages/auth/src/digest-probe.ts', old),
          lint('scripts/digest-probe.ts', old),
          lint('packages/digest/src/digest-probe.ts', old),
          lint(
            'scripts/digest-512-probe.ts',
            "import { sha3_512 } from '@noble/hashes/sha3.js'; sha3_512(new Uint8Array());",
          ),
        ]),
        expected: [
          Array<string>(4).fill('clock-digest/sha3-digest'),
          Array<string>(4).fill('clock-digest/sha3-digest'),
          [],
          [],
        ],
      });
    });
  });
}
