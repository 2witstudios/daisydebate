import { ESLint } from 'eslint';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();

// One instance for the whole file: building the typed-lint program is the
// expensive step, and under machine load it dominated every test. The lint
// scripts pass a load-tolerant --timeout instead of Bun's fixed 5 s.
let shared: ESLint | undefined;
const repositoryEslint = (): ESLint =>
  (shared ??= new ESLint({
    cwd: process.cwd(),
    overrideConfigFile: './eslint.config.mjs',
  }));

describe('repository ESLint configuration', () => {
  test('rejects ambient time and identity reads outside the allowlist', async () => {
    const eslint = repositoryEslint();
    const [result] = await eslint.lintText(
      'Date.now(); new Date(); Math.random(); crypto.randomUUID();',
      { filePath: 'packages/protocol/src/ambient.ts' },
    );

    assert({
      given: 'unallowlisted source using ambient time or identity primitives',
      should: 'report one lint error for each forbidden primitive',
      actual: result.messages.map(({ ruleId, severity }) => ({
        ruleId,
        severity,
      })),
      expected: [
        { ruleId: 'no-restricted-syntax', severity: 2 },
        { ruleId: 'no-restricted-syntax', severity: 2 },
        { ruleId: 'no-restricted-syntax', severity: 2 },
        { ruleId: 'no-restricted-syntax', severity: 2 },
      ],
    });
  });

  test('rejects `export *`, the barrel AGENTS.md forbids (RT-2.1c AC2)', async () => {
    const eslint = new ESLint({
      cwd: process.cwd(),
      overrideConfigFile: './eslint.config.mjs',
    });
    const [result] = await eslint.lintText("export * from './realtime';", {
      filePath: 'packages/protocol/src/index.ts',
    });

    assert({
      given: 'an `export * from` reintroduced into a workspace source file',
      should: 'report one no-restricted-syntax error for the wildcard export',
      actual: result.messages.map(({ ruleId, severity }) => ({
        ruleId,
        severity,
      })),
      expected: [{ ruleId: 'no-restricted-syntax', severity: 2 }],
    });
  });

  test('accepts named re-exports, the pattern `export *` would replace', async () => {
    const eslint = new ESLint({
      cwd: process.cwd(),
      overrideConfigFile: './eslint.config.mjs',
    });
    const [result] = await eslint.lintText(
      "export { parseTopic } from './realtime';",
      { filePath: 'packages/protocol/src/index.ts' },
    );

    assert({
      given: 'the named re-export form the codebase actually uses',
      should: 'report nothing',
      actual: result.messages.map(({ ruleId }) => ruleId),
      expected: [],
    });
  });

  test('still rejects `export *` inside the ambient-time exemption paths (RT-2.1c AC6, revision 4.13)', async () => {
    const eslint = new ESLint({
      cwd: process.cwd(),
      overrideConfigFile: './eslint.config.mjs',
    });
    const [result] = await eslint.lintText("export * from './index';", {
      filePath: 'packages/clock/src/index.ts',
    });

    assert({
      given:
        'an `export * from` inside packages/clock, whose ambient-time exemption turns off the rest of no-restricted-syntax',
      should:
        'still report the wildcard export: the exemption never covers ExportAllDeclaration',
      actual: result.messages.map(({ ruleId, severity }) => ({
        ruleId,
        severity,
      })),
      expected: [{ ruleId: 'no-restricted-syntax', severity: 2 }],
    });
  });
});

/** Rule ids and severities, one per reported problem, in source order. */
const problems = async (code: string, filePath: string) => {
  const [result] = await repositoryEslint().lintText(code, { filePath });
  return (result?.messages ?? []).map(({ ruleId, severity }) => ({
    ruleId,
    severity,
  }));
};

describe('process edge: one module reads process.env and globalThis (ISSUE-7)', () => {
  test('rejects process.env and Bun.env reads in app source outside the edge', async () => {
    assert({
      given:
        'web and realtime source reading process.env directly, by destructuring, and through Bun.env',
      should: 'report each read as no-restricted-properties',
      actual: [
        await problems(
          'export const flag = process.env.FOUNDATION_PROOF_ENABLED;',
          'apps/web/src/proxy.ts',
        ),
        await problems(
          'const { env } = process;\nexport const url = env.PUBLIC_APP_URL;',
          'apps/web/src/features/foundation/operations.ts',
        ),
        await problems(
          'export const level = Bun.env.LOG_LEVEL;',
          'apps/realtime/src/server.ts',
        ),
      ],
      expected: [
        [{ ruleId: 'no-restricted-properties', severity: 2 }],
        [{ ruleId: 'no-restricted-properties', severity: 2 }],
        [{ ruleId: 'no-restricted-properties', severity: 2 }],
      ],
    });
  });

  test('rejects globalThis reads in app source outside the edge', async () => {
    assert({
      given: 'a route and a lib module reading a globalThis resource',
      should: 'report no-restricted-globals',
      actual: [
        await problems(
          "export const app = Reflect.get(globalThis, 'daisyWebApp');",
          'apps/web/src/app/api/health/ready/route.ts',
        ),
        await problems(
          'export const auth = (globalThis as { daisyAuth?: unknown }).daisyAuth;',
          'apps/web/src/lib/identity.ts',
        ),
      ],
      expected: [
        [{ ruleId: 'no-restricted-globals', severity: 2 }],
        [{ ruleId: 'no-restricted-globals', severity: 2 }],
      ],
    });
  });

  test('admits exactly the two process edges', async () => {
    const edgeCode =
      'export const env = process.env; export const state = globalThis as unknown;';
    assert({
      given: "web's process-app.ts and realtime's start.ts reading both",
      should: 'report nothing: they are the edges',
      actual: [
        await problems(edgeCode, 'apps/web/src/server/process-app.ts'),
        await problems(edgeCode, 'apps/realtime/src/start.ts'),
      ],
      expected: [[], []],
    });
  });

  test('rejects mutating process.env or globalThis in tests, while reading test services stays allowed', async () => {
    const mutations = [
      "process.env.FOUNDATION_PROOF_ENABLED = 'true';",
      'delete process.env.DATABASE_URL;',
      "Object.assign(process.env, { NODE_ENV: 'test' });",
      'globalThis.fetch = (async () => new Response()) as typeof fetch;',
      "Reflect.set(globalThis, 'daisyResources', {});",
      "Reflect.deleteProperty(process.env, 'PUBLIC_APP_URL');",
    ].join('\n');
    assert({
      given:
        'an integration suite and a unit test each mutating process.env and globalThis six ways',
      should: 'report every mutation as no-restricted-syntax',
      actual: [
        await problems(mutations, 'apps/web/integration/leaky.integration.ts'),
        await problems(mutations, 'apps/web/src/server/leaky.test.ts'),
        await problems(mutations, 'apps/realtime/src/leaky.test.ts'),
      ].map((found) => found.map(({ ruleId }) => ruleId)),
      expected: Array.from({ length: 3 }, () =>
        Array.from({ length: 6 }, () => 'no-restricted-syntax'),
      ),
    });
    assert({
      given: 'an integration suite reading its test service URL',
      should: 'report nothing',
      actual: await problems(
        'export const url = process.env.TEST_DATABASE_URL;',
        'apps/web/integration/reader.integration.ts',
      ),
      expected: [],
    });
  });
});

describe('token-locked Tailwind lint rules (ADR 0028)', () => {
  const lintMarkup = async (classes: string) => {
    const eslint = repositoryEslint();
    const [result] = await eslint.lintText(
      `export const Probe = () => <div className="${classes}" />;`,
      { filePath: 'apps/web/src/ui/probe.tsx' },
    );
    return result.messages.map(({ ruleId }) => ruleId);
  };

  test('accepts registered token classes', async () => {
    assert({
      given: 'classes that all come from the Daisy theme',
      should: 'report nothing',
      actual: await lintMarkup('bg-surface p-4 text-ink-muted max-rail:p-2'),
      expected: [],
    });
  });

  test('rejects arbitrary values and properties', async () => {
    assert({
      given: 'an arbitrary value and an arbitrary property',
      should: 'report the restricted-class rule for both',
      actual: await lintMarkup('w-[10px] [mask-type:luminance]'),
      expected: [
        'better-tailwindcss/no-restricted-classes',
        'better-tailwindcss/no-restricted-classes',
      ],
    });
  });

  test('rejects default-theme classes the reset removed', async () => {
    assert({
      given: 'bg-red-500 and p-7, which Tailwind ships but Daisy does not',
      should: 'report both as unknown',
      actual: await lintMarkup('bg-red-500 p-7'),
      expected: [
        'better-tailwindcss/no-unknown-classes',
        'better-tailwindcss/no-unknown-classes',
      ],
    });
  });

  test('rejects conflicting classes', async () => {
    assert({
      given: 'two padding utilities on one element',
      should: 'report the conflict on each',
      actual: await lintMarkup('p-2 p-4'),
      expected: [
        'better-tailwindcss/no-conflicting-classes',
        'better-tailwindcss/no-conflicting-classes',
      ],
    });
  });

  test('rejects duplicate classes', async () => {
    assert({
      given: 'the same class twice',
      should: 'report a duplicate',
      actual: await lintMarkup('p-4 flex p-4'),
      expected: ['better-tailwindcss/no-duplicate-classes'],
    });
  });

  test('rejects per-element dark variants', async () => {
    assert({
      given: 'a dark: variant and a color-scheme utility',
      should: 'report the restricted-class rule for each',
      actual: await lintMarkup('dark:bg-surface scheme-dark'),
      expected: [
        'better-tailwindcss/no-restricted-classes',
        'better-tailwindcss/no-restricted-classes',
      ],
    });
  });

  test('checks the class strings in variant class modules', async () => {
    const eslint = repositoryEslint();
    const [result] = await eslint.lintText(
      [
        "const base = 'w-[10px] flex';",
        "const tones = { quiet: 'bg-surfce', loud: 'dark:bg-surface' } as const;",
        'export const probeClass = (tone: keyof typeof tones): string =>',
        '  `${base} ${tones[tone]}`;',
      ].join('\n'),
      { filePath: 'apps/web/src/ui/components/probe/probe-class.ts' },
    );
    assert({
      given:
        'an arbitrary value, a misspelled token and a dark: variant held in a class module',
      should: 'report each one, whatever the variable is named',
      actual: result.messages.map(({ ruleId }) => ruleId),
      expected: [
        'better-tailwindcss/no-restricted-classes',
        'better-tailwindcss/no-unknown-classes',
        'better-tailwindcss/no-restricted-classes',
      ],
    });
  });
});
