import { registerProcessEdgeTests } from './eslint.config-process.test-support';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  repositoryEslint,
  table,
  web,
  serverBindCases,
  serverGlobCases,
  sharedFixtureCases,
  type Problems,
} from './eslint.config.test-support';

setupRitewayBun();
registerProcessEdgeTests();

describe('repository ESLint configuration', () => {
  test('rejects ambient time and identity reads outside the allowlist', async () => {
    const eslint = repositoryEslint();
    const [result] = await eslint.lintText(
      'Date.now(); new Date(); Math.random(); crypto.randomUUID();',
      { filePath: 'packages/protocol/src/ambient.ts' },
    );

    assert({
      given: 'unallowlisted source using ambient time or identity primitives',
      should:
        'report one lint error for each forbidden primitive, plus the pure-package crypto global',
      actual: result.messages.map(({ ruleId, severity }) => ({
        ruleId,
        severity,
      })),
      expected: [
        { ruleId: 'no-restricted-syntax', severity: 2 },
        { ruleId: 'no-restricted-syntax', severity: 2 },
        { ruleId: 'no-restricted-syntax', severity: 2 },
        { ruleId: 'no-restricted-globals', severity: 2 },
        { ruleId: 'no-restricted-syntax', severity: 2 },
      ],
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

describe('restrictions every no-restricted-syntax list carries', () => {
  test('rejects `export *` everywhere, the ambient-time exemption included (RT-2.1c AC2, AC6)', async () => {
    const { actual, expected } = table([
      ["export * from './realtime';", 'packages/protocol/src/index.ts', 1],
      ["export * from './index';", 'packages/clock/src/index.ts', 1],
      ["export { parseTopic } from './realtime';", web('x.ts'), 0],
    ]);
    assert({
      given:
        'a wildcard export in a source file and in packages/clock (whose exemption turns off the rest of no-restricted-syntax), and a named re-export',
      should:
        'report each wildcard export as an error and the named form not at all',
      actual: await actual,
      expected,
    });
  });

  test('rejects an unbound Bun.serve under every glob, beside the Redis guard in every integration workspace (ISSUE-252, ISSUE-259)', async () => {
    const { actual, expected } = table(serverGlobCases);
    assert({
      given:
        'an unbound Bun.serve and a raw RedisClient in each integration workspace, an unbound Bun.serve under every other glob, and a bound one',
      should:
        'report the serve everywhere and the Redis client in every integration workspace, and the bound serve nowhere',
      actual: await actual,
      expected,
    });
  });

  test('rejects every route to a wildcard-bound server and leaves bound or unrelated calls alone (ISSUE-254, ISSUE-278)', async () => {
    const { actual, expected } = table(
      serverBindCases.map(([code, flagged]): Problems => [
        code,
        'scripts/x.test.ts',
        flagged ? 1 : 0,
      ]),
    );
    assert({
      given:
        'Bun.serve and Bun.listen, destructured, imported, aliased and globalThis forms, every wildcard spelling, node listen calls, and a Postgres LISTEN',
      should: 'report each wildcard or unaddressed bind once and nothing else',
      actual: await actual,
      expected,
    });
  });

  test('requires every e2e spec and page to go through the shared, bounded fixture (ISSUE-253, ISSUE-276, ISSUE-277)', async () => {
    const { actual, expected } = table(sharedFixtureCases);
    assert({
      given:
        'specs importing Playwright’s test by name, namespace, default, re-export or dynamic import, or calling newPage directly; the shared fixture; only types and expect; openPage',
      should:
        'reject every route to Playwright’s own test or newPage outside the shared fixture, and nothing else',
      actual: await actual,
      expected,
    });
  });

  test('rejects an argument-less toThrow in every kind of suite (ISSUE-11)', async () => {
    const [bare, named] = [
      ['', ''],
      ["'refused'", 'TypeError'],
    ].map(
      ([message, type]) =>
        `import { expect } from 'bun:test';\nawait expect(async () => {}).rejects.toThrow(${message});\nexpect(() => {}).toThrowError(${type});\nexpect(() => {}).not.toThrow();`,
    ) as [string, string];
    const suites = [
      web('server/x.test.ts'),
      'packages/db/integration/x.integration.ts',
      'apps/web/integration/x.integration.ts',
      'apps/web/e2e/x.e2e.ts',
      'scripts/x.test.ts',
    ];
    const { actual, expected } = table([
      ...suites.map((suite): Problems => [bare, suite, 2]),
      [named, web('server/x.test.ts'), 0],
    ]);
    assert({
      given:
        'unit, integration, e2e and script suites asserting a bare toThrow, one naming the error, and a strict not.toThrow()',
      should:
        'report each bare toThrow as an error and the named and negated ones not at all',
      actual: await actual,
      expected,
    });
  });
});
