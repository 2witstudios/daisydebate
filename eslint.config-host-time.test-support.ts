import { ESLint } from 'eslint';
import { assert, describe, test } from 'riteway/bun';
import tseslint from 'typescript-eslint';
import { hostTimeRules } from './eslint.config-host-time.mjs';
import { repositoryEslint } from './eslint.config.test-support';

let instance: ESLint | undefined;
/** The host-time rule alone, on probe text under invented paths. */
const hostTimeEslint = (): ESLint =>
  (instance ??= new ESLint({
    cwd: process.cwd(),
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.{ts,tsx,mjs,js}'],
        languageOptions: { parser: tseslint.parser },
      },
      hostTimeRules,
    ],
  }));

const count = async (code: string, filePath: string) => {
  const [result] = await hostTimeEslint().lintText(code, { filePath });
  return (result?.messages ?? []).filter(
    ({ ruleId }) => ruleId === 'daisy-time/host-time',
  ).length;
};

/** Each line reaches host time by one spelling. */
const spellings = [
  'setTimeout(() => undefined, 10);',
  'setInterval(() => undefined, 10);',
  'clearTimeout(handle);',
  'clearInterval(handle);',
  'const later = setTimeout; later(() => undefined, 10);',
  'schedule(setTimeout);',
  'const timers = { setTimeout };',
  'globalThis.setTimeout(() => undefined, 10);',
  "globalThis['setInterval'](() => undefined, 10);",
  'global.setTimeout(() => undefined, 10);',
  'window.setTimeout(() => undefined, 10);',
  'self.setTimeout(() => undefined, 10);',
  '(globalThis as typeof globalThis).setTimeout(() => undefined, 10);',
  'globalThis.globalThis.setTimeout(() => undefined, 10);',
  'const host = globalThis;',
  'const { setTimeout: later } = globalThis;',
  'globalThis[name](() => undefined, 10);',
  'await Bun.sleep(10);',
  'Bun.sleepSync(10);',
  "await Bun['sleep'](10);",
  'await globalThis.Bun.sleep(10);',
  'const { sleep } = Bun;',
  'const bun = Bun;',
  'AbortSignal.timeout(10);',
  'globalThis.AbortSignal.timeout(10);',
  'const { timeout } = AbortSignal;',
  'Atomics.wait(view, 0, 0, 10);',
  "import { setTimeout as wait } from 'node:timers/promises';",
  "import * as timers from 'node:timers';",
  "import { setInterval as every } from 'timers';",
  "import { scheduler } from 'timers/promises';",
  "export { setTimeout } from 'node:timers';",
  "const timersModule = await import('node:timers');",
  'const anyModule = await import(name);',
  "const required = require('timers');",
  "import { sleep } from 'bun';",
  "import { sleepSync as hold } from 'bun';",
  "import * as bun from 'bun';",
];

/** Lines that touch no host time. */
const harmless = [
  "import { S3Client } from 'bun';",
  "import type { SQL } from 'bun';",
  'const bytes = Bun.file(path);',
  'const ok = signal instanceof AbortSignal;',
  'const either = AbortSignal.any([first, second]);',
  'const crypto = globalThis.crypto;',
  'const local = { setTimeout: (run: () => void) => run() }; local.setTimeout(() => undefined);',
  'function f(setTimeout: (run: () => void) => void) { setTimeout(() => undefined); }',
  'await waits.sleep(10, signal);',
  'setImmediate(() => undefined);',
  "const browser = typeof window !== 'undefined';",
  'type Handle = ReturnType<typeof setTimeout>;',
];

export function registerHostTimeTests() {
  describe('host time stays in one module (R4.7)', () => {
    test('every spelling of a host timer is refused in server code', async () => {
      const each = await Promise.all(
        spellings.map((line) => count(line, 'packages/media/src/probe.ts')),
      );
      assert({
        given: `${spellings.length} spellings of a host timer, one per module`,
        should: 'refuse each one',
        actual: spellings.filter((_, index) => each[index] === 0),
        expected: [],
      });
    });

    test('the repository configuration runs the rule', async () => {
      const [result] = await repositoryEslint().lintText(
        'export const later = () => setTimeout(() => undefined, 10);',
        { filePath: 'packages/media/src/probe.ts' },
      );
      assert({
        given: 'a host timer in package source, linted as `bun lint` lints it',
        should: 'be refused by daisy-time/host-time',
        actual: (result?.messages ?? []).some(
          ({ ruleId }) => ruleId === 'daisy-time/host-time',
        ),
        expected: true,
      });
    });

    test('code that touches no host time passes', async () => {
      const each = await Promise.all(
        harmless.map((line) => count(line, 'apps/realtime/src/probe.ts')),
      );
      assert({
        given: 'host members that do not wait, injected waits and local names',
        should: 'refuse none',
        actual: harmless.filter((_, index) => each[index] !== 0),
        expected: [],
      });
    });

    test('the rule covers server sources and leaves tests, browser files and the host module alone', async () => {
      const code = 'setTimeout(() => undefined, 10);';
      assert({
        given: 'one host timer in each kind of file',
        should:
          'refuse it in app and package sources, including web server code, and nowhere else',
        actual: {
          webServer: await count(code, 'apps/web/src/server/probe.ts'),
          webFeature: await count(code, 'apps/web/src/features/x/probe.ts'),
          worker: await count(code, 'apps/broadcast-worker/src/probe.ts'),
          package: await count(code, 'packages/db/src/probe.ts'),
          host: await count(code, 'packages/worker/src/host.ts'),
          unitTest: await count(code, 'packages/db/src/probe.test.ts'),
          support: await count(code, 'packages/db/src/probe.test-support.ts'),
          integration: await count(
            code,
            'apps/web/integration/probe.integration.ts',
          ),
          browserUi: await count(code, 'apps/web/src/ui/probe.tsx'),
          browserNamed: await count(
            code,
            'apps/web/src/features/x/probe-browser.ts',
          ),
          useClient: await count(
            `'use client';\n${code}`,
            'apps/web/src/features/x/probe.ts',
          ),
        },
        expected: {
          webServer: 1,
          webFeature: 1,
          worker: 1,
          package: 1,
          host: 0,
          unitTest: 0,
          support: 0,
          integration: 0,
          browserUi: 0,
          browserNamed: 0,
          useClient: 0,
        },
      });
    });
  });
}
