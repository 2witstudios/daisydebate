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

/** Each problem ESLint reports for `code` at `filePath`, with its severity. */
const problems = async (code: string, filePath: string) => {
  const [result] = await repositoryEslint().lintText(code, { filePath });
  return (result?.messages ?? []).map(({ ruleId, severity }) => ({
    ruleId,
    severity,
  }));
};
/** The rule id of each problem ESLint reports for `code` at `filePath`. */
const ruleIds = async (code: string, filePath: string) =>
  (await problems(code, filePath)).map(({ ruleId }) => ruleId);
type Problems = readonly [code: string, filePath: string, errors: number];
const table = (cases: readonly Problems[]) => ({
  actual: Promise.all(cases.map(([code, path]) => problems(code, path))),
  expected: cases.map(([, , errors]) =>
    Array(errors).fill({ ruleId: 'no-restricted-syntax', severity: 2 }),
  ),
});

type Case = readonly [code: string, filePath: string, ruleIds: string[]];
const outcomes = (cases: readonly Case[]) =>
  Promise.all(cases.map(([code, filePath]) => ruleIds(code, filePath)));
const expectedOf = (cases: readonly Case[]) => cases.map(([, , ids]) => ids);

const web = (path: string) => `apps/web/src/${path}`;
const [props, globals, imports] = ['properties', 'globals', 'imports'].map(
  (kind) => [`no-restricted-${kind}`],
);
const edgeImport = (from: string, name = 'processApp', ext = '') =>
  `import { ${name} } from '${from}process-app${ext}';\nexport const x = ${name};`;
const reads =
  'export const env = process.env;\nexport const g = globalThis as unknown;';
const mutations = [
  "process.env.FOUNDATION_PROOF_ENABLED = 'true';",
  'delete process.env.DATABASE_URL;',
  "Object.assign(process.env, { NODE_ENV: 'test' });",
  'globalThis.fetch = (async () => new Response()) as typeof fetch;',
  "Reflect.set(globalThis, 'daisyResources', {});",
  "Reflect.deleteProperty(process.env, 'PUBLIC_APP_URL');",
].join('\n');
const sixMutations = Array.from({ length: 6 }, () => 'no-restricted-syntax');
const route = web('app/api/health/ready/route.ts');
const lazyEdge = (path: string) => `export const l = () => import('${path}');`;
const suite = 'apps/web/integration/leak.integration.ts';
const e2eServer = 'apps/web/e2e/support/server.ts';
/** Every spelling that reaches the edge outside its entries (review 2). */
const computed = "export const l = import(`./${'process-app'}`);";
const escapes: ReadonlyArray<readonly [string, string]> = [
  [edgeImport('../../server/', 'processApp', '.js'), web('features/x.ts')],
  [edgeImport('/repo/apps/web/src/server/', 'processApp', '.ts'), web('x.ts')],
  [lazyEdge('../../server/process-app'), web('features/x.ts')],
  [lazyEdge('../../server/process-app.js'), route],
  [computed, web('server/x.ts')],
  [edgeImport('../src/server/'), suite],
  [lazyEdge('../src/server/process-app'), suite],
  [edgeImport('../../src/server/'), 'apps/web/e2e/journey.e2e.ts'],
];
const escapeRule = (code: string) =>
  code.startsWith('import {') ? imports : ['no-restricted-syntax'];

describe('process edge: one module reads process.env and globalThis (ISSUE-7)', () => {
  test('rejects ambient reads and edge imports outside the edge', async () => {
    const cases: Case[] = [
      ['export const f = process.env.X;', web('proxy.ts'), props],
      [
        'const { env } = process;\nexport const e = env;',
        web('lib/x.ts'),
        props,
      ],
      ['export const level = Bun.env.X;', 'apps/realtime/src/server.ts', props],
      ["export const a = Reflect.get(globalThis, 'a');", route, globals],
      [
        'export const a = globalThis as unknown;',
        web('lib/identity.ts'),
        globals,
      ],
      [
        edgeImport('../../server/'),
        web('features/foundation/leak.ts'),
        imports,
      ],
      [edgeImport('../server/'), web('lib/identity.ts'), imports],
      [edgeImport('../../../../server/'), route, imports],
      [edgeImport('./'), web('server/routes.ts'), imports],
      ...escapes.map(([code, file]): Case => [code, file, escapeRule(code)]),
    ];
    assert({
      given:
        'app source reading process.env, Bun.env or globalThis, or importing the process edge as a locator',
      should: 'report each as the matching restriction',
      actual: await outcomes(cases),
      expected: expectedOf(cases),
    });
  });

  test('admits the edges, route bindings and the documented process entries', async () => {
    const cases: Case[] = [
      [reads, web('server/process-app.ts'), []],
      [reads, 'apps/realtime/src/start.ts', []],
      [edgeImport('../../../../server/', 'processRoute'), route, []],
      [edgeImport('./server/'), web('proxy.ts'), []],
      [edgeImport('./server/'), web('instrumentation.ts'), []],
      [edgeImport('./'), web('server/start.ts'), []],
      [edgeImport('../server/'), web('lib/request-session.ts'), []],
      [lazyEdge('./server/process-app'), web('instrumentation.ts'), []],
      [edgeImport('../../src/server/', 'adoptProcessApp'), e2eServer, []],
      [
        'export const u = process.env.TEST_DATABASE_URL;',
        'apps/web/integration/r.integration.ts',
        [],
      ],
    ];
    assert({
      given:
        'the two edges, a processRoute binding, the process entries and a test reading its service URL',
      should: 'report nothing',
      actual: await outcomes(cases),
      expected: expectedOf(cases),
    });
  });

  test('rejects mutating process.env or globalThis in app tests', async () => {
    const cases: Case[] = [
      [mutations, 'apps/web/integration/leaky.integration.ts', sixMutations],
      [mutations, web('server/leaky.test.ts'), sixMutations],
      [mutations, 'apps/realtime/src/leaky.test.ts', sixMutations],
    ];
    assert({
      given:
        'an integration suite and two unit tests mutating process.env and globalThis six ways',
      should: 'report every mutation as no-restricted-syntax',
      actual: await outcomes(cases),
      expected: expectedOf(cases),
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
