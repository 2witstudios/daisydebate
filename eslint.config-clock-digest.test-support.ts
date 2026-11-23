import { assert, describe, test } from 'riteway/bun';
import { repositoryEslint } from './eslint.config.test-support';

export function registerClockDigestTests() {
  describe('shared instant and digest helpers', () => {
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
        'let assigned; ({ parse: assigned } = Date);',
        'const DateAlias = Date, another = DateAlias;',
        'export const indirect = another.parse(input);',
        "const method = 'parse';",
        'export const computed = another[method](input);',
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
          lint(
            'scripts/local-date-probe.ts',
            "export function local(Date: Parser) { const date = Date; const method = 'parse'; return date[method](input) + date.parse(input); }",
          ),
        ]),
        expected: [
          Array<string>(7).fill('clock-digest/iso-instant'),
          Array<string>(7).fill('clock-digest/iso-instant'),
          [],
          [],
        ],
      });
    });

    test('rejects every hasher and MAC outside the digest package', async () => {
      // RECON-3.5: the rule matched only SHA3-256, so SHA-256, HMAC and the
      // CSP hash were built in four places.
      const spellings = [
        "import { createHash as makeHash } from 'node:crypto'; makeHash('sha256');",
        "import { createHmac } from 'node:crypto'; createHmac('sha256', key);",
        "import * as crypto from 'node:crypto'; const hashing = crypto; hashing.createHash('sha1');",
        "import { hash } from 'node:crypto'; hash('sha256', text);",
        "const { createHmac: mac } = require('node:crypto'); mac('sha512', key);",
        "new Bun.CryptoHasher('sha256');",
        'const runtime = Bun; const { CryptoHasher: Hasher } = runtime; new Hasher(algorithm);',
        "import { sha3_256 } from '@noble/hashes/sha3.js';",
        "import { sha256 } from '@noble/hashes/sha2.js';",
        "import { hmac } from '@noble/hashes/hmac.js';",
        "const noble = require('@noble/hashes/sha2.js');",
        "await import('@noble/hashes/legacy.js');",
        "await crypto.subtle.digest('SHA-256', bytes);",
        "const { subtle } = crypto; await subtle.digest('SHA-1', bytes);",
        "await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);",
        "await globalThis.crypto.subtle.sign('HMAC', key, bytes);",
        "(await import('node:crypto')).createHash('sha256');",
        "const native = await import('node:crypto'); native.createHmac('sha256', key);",
      ];
      const legal = [
        "import { utf8ToBytes } from '@noble/hashes/utils.js';",
        "await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, bytes);",
        "export const hash = (createHash: Hasher) => createHash('sha256');",
        "import { sha256Hex } from '@daisy/digest'; sha256Hex('x');",
      ];
      assert({
        given:
          'each native, noble and WebCrypto hash or HMAC spelling, in source, a script and the digest package',
        should: 'refuse each one outside packages/digest only',
        actual: await Promise.all([
          ...spellings.map((code) => lint('packages/media/src/probe.ts', code)),
          ...spellings.map((code) => lint('scripts/probe.ts', code)),
          ...spellings.map((code) =>
            lint('packages/digest/src/probe.ts', code),
          ),
          ...legal.map((code) => lint('apps/web/src/probe.ts', code)),
        ]),
        expected: [
          ...spellings.map(() => ['clock-digest/digest-home']),
          ...spellings.map(() => ['clock-digest/digest-home']),
          ...spellings.map(() => []),
          ...legal.map(() => []),
        ],
      });
    });

    test("rejects reading an instant's milliseconds through a constructed Date", async () => {
      // RECON-3.5: new Date(x).getTime() slipped past the Date.parse ban.
      const spellings = [
        'export const ms = new Date(at).getTime();',
        'export const ms = new Date(at).valueOf();',
        "export const ms = new Date(at)['getTime']();",
        'const date = new Date(at); export const ms = date.getTime();',
        'export const ms = +new Date(at);',
        'export const ms = Number(new Date(at));',
        'export const ms = new Date(at) - start;',
        'export const late = new Date(at) < new Date(due);',
        'export const ms = new globalThis.Date(at).getTime();',
      ];
      const legal = [
        'export const ms = row.at.getTime();',
        'export const late = row.expiresAt <= now;',
        'export const at = new Date(ms).toISOString();',
        'export const now = new Date().getTime();',
      ];
      assert({
        given: 'each spelling outside and inside the clock package',
        should: 'refuse them outside packages/clock only',
        actual: await Promise.all([
          ...spellings.map((code) => lint('packages/db/src/probe.ts', code)),
          ...spellings.map((code) => lint('packages/clock/src/probe.ts', code)),
          ...legal.map((code) => lint('packages/db/src/probe.ts', code)),
        ]),
        expected: [
          ...spellings.map(() => ['clock-digest/iso-instant']),
          ...spellings.map(() => []),
          ...legal.map(() => []),
        ],
      });
    });
  });
}
