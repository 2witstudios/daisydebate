import { registerClockDigestTests } from './eslint.config-clock-digest.test-support';
import { registerHostTimeTests } from './eslint.config-host-time.test-support';
import { registerProcessEdgeTests } from './eslint.config-process.test-support';
import { registerRequestPathTests } from './eslint.config-request-path.test-support';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  repositoryEslint,
  typedRepositoryEslint,
  table,
  web,
  serverBindCases,
  serverGlobCases,
  sharedFixtureCases,
  type Problems,
  throwSuitePaths,
} from './eslint.config.test-support';

setupRitewayBun();
registerProcessEdgeTests();
registerClockDigestTests();
registerRequestPathTests();
registerHostTimeTests();

describe('repository ESLint configuration', () => {
  test('rejects pathname splitting under the App Router', async () => {
    const [result] = await repositoryEslint().lintText(
      "const url = new URL('https://example.com'); url.pathname.split('/'); url['pathname']['split']('/'); url[`pathname`].split('/'); url.pathname[`split`]('/'); url.search.split('&'); const pathname = 'slug'; const lookup = { slug: 'a-b' }; lookup[pathname]?.split('-');",
      { filePath: 'apps/web/src/app/api/rooms/[roomId]/route.ts' },
    );
    assert({
      given: 'dot and bracket pathname splits and unrelated string splits',
      should: 'reject the four pathname splits',
      actual: result?.messages.map(({ message }) => message),
      expected: Array<string>(4).fill(
        'Take the id from the route params (processRoute.withParams) or pass the bound value; never split or match a request path.',
      ),
    });
  });

  test('rejects ambient globals in feature models', async () => {
    const eslint = repositoryEslint();
    const source = 'performance.now(); setTimeout(() => {}, 1);';
    const results = await Promise.all(
      ['model/nested/pulse.ts', 'browser-adapter.ts'].map((path) =>
        eslint.lintText(source, {
          filePath: `apps/web/src/features/realtime/${path}`,
        }),
      ),
    );
    assert({
      given: 'ambient clock and timer reads in a feature model and an adapter',
      should: 'report the model reads through the package purity rule',
      actual: results.map(([result]) =>
        result.messages
          .filter(({ ruleId }) => ruleId === 'no-restricted-globals')
          .map(({ line, column }) => [line, column]),
      ),
      expected: [
        [
          [1, 1],
          [1, 20],
        ],
        [],
      ],
    });
  });

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

describe('form actions before hydration (ADR 0114)', () => {
  test('requires callable form actions wherever the form omits a method', async () => {
    const [result] = await typedRepositoryEslint().lintText(
      `export function Forms({
        address, post, optional,
      }: {
        address: string;
        post: (data: FormData) => void;
        optional?: (data: FormData) => void;
      }) {
        return <>
          <form action={address} />
          <form action={optional} />
          <form action={address} method="post" />
          <form action={post} />
        </>;
      }`,
      { filePath: 'apps/admin/src/app/search-form.tsx' },
    );
    assert({
      given: 'form addresses, optional actions, and callable actions',
      should: 'reject only the address and optional action without a method',
      actual: result!.messages.map(({ ruleId, line }) => ({ ruleId, line })),
      expected: [9, 10].map((line) => ({
        ruleId: 'daisy-form/require-callable-action',
        line,
      })),
    });
  });
});

describe('refusal reasons, never messages (ISSUE-1010)', () => {
  const problems = async (code: string) => {
    const [result] = await repositoryEslint().lintText(code, {
      filePath: 'packages/db/src/refusal-probe.ts',
    });
    return result!.messages.filter(
      ({ ruleId }) => ruleId === 'no-restricted-syntax',
    ).length;
  };
  test('refuses behaviour read from a message and refusal words minted as one', async () => {
    assert({
      given:
        "a comparison, a lookup, and a refusal word, ternary or decision's refusal as a message",
      should: 'report each one',
      actual: [
        await problems(
          "export const a = (error: Error) => error.message === 'x';",
        ),
        await problems(
          'export const a = (error: Error, known: string[]) => known.includes(error.message);',
        ),
        await problems(
          'export const a = (error: Error, map: object) => Object.hasOwn(map, error.message);',
        ),
        await problems(
          "export const a = createAppError('CONFLICT', 'round-decided');",
        ),
        await problems(
          "export const a = (b: boolean) => createAppError('CONFLICT', b ? 'too-early' : 'closed-window');",
        ),
        await problems(
          "export const a = (decision: { refusal: string }) => createAppError('VALIDATION', decision.refusal);",
        ),
        await problems(
          "export const a = (error?: Error) => error?.message === 'x';",
        ),
        await problems(
          'export const a = (error: Error, map: Record<string, number>) => map[error.message];',
        ),
        await problems(
          "export const a = (error: Error) => { switch (error.message) { case 'x': return 1; default: return 2; } };",
        ),
        await problems(
          "export const a = (error?: Error) => { switch (error?.message) { case 'x': return 1; default: return 2; } };",
        ),
        await problems(
          'export const a = (error: Error | undefined, map: Record<string, number>) => map[error?.message ?? ""];',
        ),
        await problems(
          'export const a = (error: Error | undefined, known: string[]) => known.includes(error?.message);',
        ),
        await problems(
          'export const a = (error: Error | undefined, map: Record<string, number>) => map[error?.message];',
        ),
      ],
      expected: [1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 0, 1, 1],
    });
  });
  test('holds in integration suites, and for mints in scripts', async () => {
    const at = async (filePath: string, code: string) => {
      const [result] = await repositoryEslint().lintText(code, { filePath });
      return result!.messages.filter(({ message }) =>
        /error\.(reason)|createRefusal/.test(message),
      ).length;
    };
    const read = "export const a = (error: Error) => error.message === 'x';";
    const mint =
      "export const a = createAppError('CONFLICT', 'round-decided');";
    assert({
      given: 'a message read and a refusal word mint on overridden paths',
      should:
        'report both in integration suites, and only the mint in a script',
      actual: [
        await at('packages/db/integration/refusal-probe.integration.ts', read),
        await at('apps/web/integration/refusal-probe.integration.ts', mint),
        await at('apps/admin/integration/refusal-probe.integration.ts', read),
        await at('scripts/refusal-probe.ts', mint),
        await at('scripts/refusal-probe.ts', read),
      ],
      expected: [1, 1, 1, 1, 0],
    });
  });
  test('leaves a reason, plain internal text and a vendor error alone', async () => {
    assert({
      given:
        'a reason read, an English message, a vendor text check, a code ternary, a cause object and a lookup by refusal',
      should: 'report nothing',
      actual: [
        await problems(
          "export const a = (error: AppError) => error.reason === 'x';",
        ),
        await problems(
          "export const a = createAppError('CONFLICT', 'The round moved on');",
        ),
        await problems(
          "export const a = (error: Error) => error.message.includes('NOSCRIPT');",
        ),
        await problems(
          "export const a = (b: string) => createAppError(b === 'too-large' ? 'PAYLOAD_TOO_LARGE' : 'VALIDATION');",
        ),
        await problems(
          "export const a = createAppError('INFRASTRUCTURE', 'Transaction failed', { recovery: 'rolled-back' });",
        ),
        await problems(
          "export const a = (refusal: 'CONFLICT', copy: Record<string, string>) => createAppError(refusal, copy[refusal]);",
        ),
      ],
      expected: [0, 0, 0, 0, 0, 0],
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
    const { actual, expected } = table([
      ...throwSuitePaths.map((suite): Problems => [bare, suite, 2]),
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

test('pure packages reject Bun runtime subpaths while delivery adapters retain SQLite access', async () => {
  const eslint = repositoryEslint();
  const results = await Promise.all(
    ['protocol', 'debate-engine', 'auth', 'errors'].map(async (name) => {
      const [result] = await eslint.lintText(
        "import { Database } from 'bun:sqlite'; export const database = Database;",
        { filePath: `packages/${name}/src/runtime-probe.ts` },
      );
      return result!.messages.some(
        (message) =>
          message.ruleId === 'no-restricted-imports' && message.severity === 2,
      );
    }),
  );
  const [adapter] = await eslint.lintText(
    "import { Database } from 'bun:sqlite'; export const database = Database;",
    { filePath: 'apps/web/src/features/media-capture/runtime-probe.ts' },
  );
  assert({
    given:
      'a Bun SQLite import in each framework-free package and its owning web storage edge',
    should:
      'reject every pure-runtime import without globally banning the approved adapter',
    actual: {
      pure: results,
      adapter: adapter!.messages.some(
        (message) => message.ruleId === 'no-restricted-imports',
      ),
    },
    expected: { pure: [true, true, true, true], adapter: false },
  });
});

describe('a cast that changes nothing is refused', () => {
  const filePath = 'packages/protocol/src/assert-never.ts';
  const rule = '@typescript-eslint/no-unnecessary-type-assertion';
  const problems = async (source: string) => {
    const [result] = await typedRepositoryEslint().lintText(source, {
      filePath,
    });
    return result!.messages.filter(({ ruleId }) => ruleId === rule).length;
  };
  test('a needless assertion fails and a narrowing one passes', async () => {
    assert({
      given:
        'a string asserted to be a string, a non-null value asserted non-null, and an unknown value narrowed',
      should: 'report the two that change nothing',
      actual: [
        await problems(
          'export const same = (name: string): string => name as string;',
        ),
        await problems(
          'export const present = (name: string): string => name!;',
        ),
        await problems(
          'export const narrowed = (value: unknown): string => value as string;',
        ),
      ],
      expected: [1, 1, 0],
    });
  });
});

describe('a promise is awaited and what is thrown is an Error', () => {
  const filePath = 'packages/protocol/src/assert-never.ts';
  const count = async (rule: string, source: string) => {
    const [result] = await typedRepositoryEslint().lintText(source, {
      filePath,
    });
    return result!.messages.filter(({ ruleId }) => ruleId === rule).length;
  };
  test('a dropped promise fails; an awaited or voided one passes', async () => {
    const rule = '@typescript-eslint/no-floating-promises';
    const work = 'const work = async (): Promise<void> => {};';
    assert({
      given: 'a promise dropped, one marked void and one awaited',
      should: 'report only the dropped one',
      actual: [
        await count(
          rule,
          `${work} export const run = (): void => { work(); };`,
        ),
        await count(
          rule,
          `${work} export const run = (): void => { void work(); };`,
        ),
        await count(
          rule,
          `${work} export const run = async (): Promise<void> => { await work(); };`,
        ),
      ],
      expected: [1, 0, 0],
    });
  });
  test('throwing a non-error fails; an Error or a caught value passes', async () => {
    const rule = '@typescript-eslint/only-throw-error';
    assert({
      given: 'a thrown string, a thrown Error and a rethrown caught value',
      should: 'report only the string',
      actual: [
        await count(rule, "export const fail = (): never => { throw 'no'; };"),
        await count(
          rule,
          "export const fail = (): never => { throw new Error('no'); };",
        ),
        await count(
          rule,
          'export const again = (caught: unknown): never => { throw caught; };',
        ),
      ],
      expected: [1, 0, 0],
    });
  });
});

describe('a switch over a union names every member', () => {
  // The rule reads types, so the probe is linted as a source file on disk.
  const filePath = 'packages/protocol/src/assert-never.ts';
  const rule = '@typescript-eslint/switch-exhaustiveness-check';
  const problems = async (cases: string) => {
    const [result] = await typedRepositoryEslint().lintText(
      `type Status = 'opening' | 'active' | 'completed';
       export const label = (status: Status): string => {
         switch (status) { ${cases} }
       };`,
      { filePath },
    );
    return result!.messages.filter(({ ruleId }) => ruleId === rule).length;
  };
  test('a missing member fails, with a default or without one', async () => {
    assert({
      given:
        'a switch that names every member, one that leaves a member to its default, and one that leaves it out',
      should: 'report only the two that do not name every member',
      actual: [
        await problems(
          "case 'opening': case 'active': case 'completed': return status;",
        ),
        await problems(
          "case 'opening': case 'active': return status; default: return 'over';",
        ),
        await problems("case 'opening': case 'active': return status;"),
      ],
      expected: [0, 1, 1],
    });
  });
});

describe('a check the type already answers is refused', () => {
  const filePath = 'packages/protocol/src/assert-never.ts';
  const rule = '@typescript-eslint/no-unnecessary-condition';
  const problems = async (source: string) => {
    const [result] = await typedRepositoryEslint().lintText(source, {
      filePath,
    });
    return result!.messages.filter(({ ruleId }) => ruleId === rule).length;
  };
  test('a dead check fails and a live one passes', async () => {
    assert({
      given:
        'a string checked for null, a fallback for a value that cannot be missing, and an optional value checked',
      should: 'report the two the type already answers',
      actual: [
        await problems(
          "export const name = (value: string): string => (value === null ? 'none' : value);",
        ),
        await problems(
          "export const name = (value: string): string => value ?? 'none';",
        ),
        await problems(
          "export const name = (value?: string): string => value ?? 'none';",
        ),
      ],
      expected: [1, 1, 0],
    });
  });
  test('the rule rejects a dead fallback in packages/db/src', async () => {
    const [result] = await typedRepositoryEslint().lintText(
      "export const name = (value: string): string => value ?? 'none';",
      { filePath: 'packages/db/src/index.ts' },
    );
    assert({
      given: 'a dead fallback in the database package',
      should: 'report it',
      actual: result!.messages.filter(({ ruleId }) => ruleId === rule).length,
      expected: 1,
    });
  });
});

describe('a non-null assertion is refused except on an index', () => {
  const rule = 'daisy/no-non-null-assertion';
  const count = async (source: string, filePath: string) => {
    const [result] = await repositoryEslint().lintText(source, { filePath });
    return result!.messages.filter(({ ruleId }) => ruleId === rule).length;
  };
  const source = (expression: string) =>
    `declare const value: string | undefined;
     declare const record: { name?: string };
     declare const names: Map<string, string>;
     declare const find: () => string | undefined;
     declare const list: readonly string[];
     declare const index: number;
     export const read = (): string => ${expression};`;
  test('value, named property and call assertions fail; array index assertions pass', async () => {
    const path = 'packages/protocol/src/x.ts';
    assert({
      given:
        'assertions on a value, a named property with or without type syntax, a map read, a call, and array indices',
      should: 'report the value, property and call assertions',
      actual: [
        await count(source('value!'), path),
        await count(source('record.name!'), path),
        await count(source("record['name']!"), path),
        await count(source('record[`name`]!'), path),
        await count(source("record['name' as const]!"), path),
        await count(source("record['name' satisfies string]!"), path),
        await count(source("names.get('a')!"), path),
        await count(source('find()!'), path),
        await count(source('list[index]!'), path),
        await count(source('list[0]!'), path),
        await count(source('list[0 as const]!'), path),
      ],
      expected: [1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
    });
  });
  test('the rule covers app and database source and skips unit tests', async () => {
    assert({
      given: 'value! in app source, a test file and the database package',
      should: 'report it in app and database source',
      actual: [
        await count(source('value!'), web('x.tsx')),
        await count(source('value!'), 'packages/protocol/src/x.test.ts'),
        await count(source('value!'), 'packages/db/src/x.ts'),
      ],
      expected: [1, 0, 1],
    });
  });
});

describe('unit tests run on virtual time (ADR 0164)', () => {
  const sleeps = async (code: string, filePath: string) => {
    const [result] = await repositoryEslint().lintText(code, { filePath });
    return result!.messages.filter(
      ({ ruleId }) => ruleId === 'test-time/no-real-sleep',
    ).length;
  };
  const timed = [
    "import { setTimeout as timerSleep } from 'node:timers/promises';",
    "import * as timers from 'node:timers';",
    'await Bun.sleep(300);',
    'await globalThis.Bun.sleep(300);',
    "await Bun['sleep'](300);",
    'Bun.sleepSync(5);',
    'await new Promise((done) => setTimeout(done, 20));',
    'const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));',
    'globalThis.setTimeout(() => undefined);',
    'const beat = setInterval(() => undefined, 10);',
    'await timerSleep(20);',
    'timers.setTimeout(() => undefined, 20);',
  ].join('\n');
  const yields = [
    "import { setTimeout as timerSleep } from 'node:timers/promises';",
    'await Bun.sleep(0);',
    'await new Promise((done) => setTimeout(done, 0));',
    'await new Promise((done) => setImmediate(done));',
    'await timerSleep(0);',
  ].join('\n');
  test('a timed wait in a unit test or its support is an error; a zero delay is not', async () => {
    assert({
      given:
        'ten timed waits and four zero-delay yields, in unit tests, test support, an integration suite and production code',
      should:
        'report each timed wait in unit test code only, and no yield anywhere',
      actual: {
        unit: await sleeps(timed, web('features/clock-probe.test.ts')),
        tsx: await sleeps(timed, web('ui/clock-probe.test.tsx')),
        support: await sleeps(
          timed,
          'packages/media/src/probe.test-support.ts',
        ),
        script: await sleeps(timed, 'scripts/clock-probe.test.ts'),
        yields: await sleeps(yields, web('features/clock-probe.test.ts')),
        integration: await sleeps(
          timed,
          'apps/web/integration/clock-probe.integration.ts',
        ),
        integrationSupport: await sleeps(
          timed,
          'packages/db/integration/probe.test-support.ts',
        ),
        e2e: await sleeps(timed, 'apps/web/e2e/clock-probe.e2e.ts'),
        production: await sleeps(timed, 'packages/media/src/clock-probe.ts'),
      },
      expected: {
        unit: 10,
        tsx: 10,
        support: 10,
        script: 10,
        yields: 0,
        integration: 0,
        integrationSupport: 0,
        e2e: 0,
        production: 0,
      },
    });
  });
});

describe('database statement and lock boundaries', () => {
  test('reserves each raw database form for its owning module', async () => {
    const boundaryCases = [
      [
        'tx.ts',
        "import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres'; export type Database = BunSQLDatabase;",
      ],
      [
        'tx.ts',
        "export type Database = import('drizzle-orm/bun-sql/postgres').BunSQLDatabase;",
      ],
      [
        'tx.ts',
        "import type * as Driver from 'drizzle-orm/bun-sql/postgres'; export type Database = Driver.BunSQLDatabase;",
      ],
      ['tx.ts', 'connection.transaction(work);'],
      ['tx.ts', "connection['transaction'](work);"],
      ['raw-rows.ts', 'connection.execute(statement);'],
      ['raw-rows.ts', "connection['execute'](statement);"],
      ['raw-rows.ts', 'export const rows = result as unknown as Row[];'],
      [
        'locks.ts',
        'export const statement = sql`select PG_TRY_ADVISORY_LOCK(1)`;',
      ],
      ['locks.ts', "export const statement = 'pg_advisory_unlock';"],
      ['locks.ts', 'export const probe = /pg_advisory_lock/;'],
      // RECON-3.2: a typed fragment asserts a column nobody parsed.
      ['raw-rows.ts', 'export const held = sql<boolean>`true`;'],
      ['raw-rows.ts', 'export const held = drizzle.sql<number>`1`;'],
      ['raw-rows.ts', 'export const held: SQL<boolean> = sql`true`;'],
      ['raw-rows.ts', 'export const read = (held: SQL<number>) => held;'],
      ['raw-rows.ts', 'export const held = sql`true`.mapWith(Boolean);'],
      ['raw-rows.ts', "export const held = fragment['mapWith'](Number);"],
    ] as const;
    // The participant database's package and the admin app's own database
    // (RECON-3.2: the admin app kept 17 transactions, 2 raw statements and a
    // raw audit lock outside the bans).
    const roots = [
      {
        source: 'packages/db/src',
        homes: 'packages/db/src',
        suite: 'packages/db/integration/probe.integration.ts',
      },
      {
        source: 'apps/admin/src',
        homes: 'apps/admin/src/db',
        suite: 'apps/admin/integration/probe.integration.ts',
      },
    ];
    const cases: Problems[] = roots.flatMap((root) =>
      boundaryCases.flatMap(([home, code]): Problems[] => [
        [code, `${root.source}/feature/probe.ts`, 1],
        [code, `${root.homes}/${home}`, 0],
        [code, root.suite, 0],
      ]),
    );
    const { actual, expected } = table(cases);
    assert({
      given:
        'each direct DB form in a feature, its owning module, and an integration suite, in each database tree',
      should: 'require the owning boundary within DB source',
      actual: await actual,
      expected,
    });
  });

  test('an untyped or unknown SQL fragment stays legal', async () => {
    const { actual, expected } = table([
      ['export const held = sql`true`;', 'packages/db/src/feature/probe.ts', 0],
      [
        'export const held: SQL<unknown> = sql`true`;',
        'packages/db/src/feature/probe.ts',
        0,
      ],
      [
        'export const held: SQL = sql`true`;',
        'apps/admin/src/feature/probe.ts',
        0,
      ],
    ]);
    assert({
      given: 'a fragment that asserts no column type',
      should: 'pass the boundary',
      actual: await actual,
      expected,
    });
  });

  test('native SQL consumption matrix preserves the decoder boundary', async () => {
    const lint = typedRepositoryEslint();
    const rule = 'db-native-rows/require-query';
    const feature = 'packages/db/src/attendance-facts.ts';
    const source = (body: string, imports = '') =>
      'import type { SQL } from "bun";\n' +
      imports +
      'export async function read(client: SQL) { ' +
      body +
      ' }';
    const tagged = 'client`select 1 as value`';
    const imports =
      'import { z } from "zod";\n' +
      'import { availabilityEvidenceRow, availabilitySamplesFrom } from "./availability-operations";\n' +
      'import { query } from "./raw-rows";\n';
    const typedStatement = 'client<{ value: number }[]>`select 1 as value`';
    const parsedStatement =
      'query(' + tagged + ', z.object({ value: z.int() }))';
    const directCases = [
      [
        1,
        source(
          'return z.array(availabilityEvidenceRow).parse(await availabilitySamplesFrom((strings, ...values) => client(strings, ...values), "2026-11-20T00:00:00Z"));',
          'import { z } from "zod";\nimport { availabilityEvidenceRow, availabilitySamplesFrom } from "./availability-operations";\n',
        ),
        feature,
      ],
      [1, source('return ' + tagged + ';'), feature],
      [
        1,
        'import type { SQL } from "bun"; export const read = async (client: SQL) => ' +
          tagged +
          ';',
        feature,
      ],
      [1, source('return ' + tagged + '.then((rows) => rows);'), feature],
      [1, source('return await ' + tagged + ';'), feature],
      [1, source('return await client.unsafe("select 1 as value");'), feature],
      [
        1,
        source('return await client["unsafe"]("select 1 as value");'),
        feature,
      ],
      [
        0,
        source(
          'return query(' + tagged + ', z.object({ value: z.int() }));',
          'import { z } from "zod";\nimport { query } from "./raw-rows";\n',
        ),
        feature,
      ],
      [0, source('await client`delete from fixture`;'), feature],
      [
        0,
        source(
          'const receipt = await client<{ command: string }>`commit`; return receipt.command;',
        ),
        'packages/db/src/bounded-transaction.ts',
      ],
      [
        0,
        source('return ' + tagged + ';'),
        'packages/db/integration/db-boundary.integration.ts',
      ],
      [
        0,
        source('return ' + tagged + ';'),
        'packages/db/src/transaction-client.ts',
      ],
      [
        1,
        source('return await ' + tagged + ';'),
        'packages/db/src/transaction-client.ts',
      ],
    ] as const;
    const settlementCases = [
      [
        1,
        `const raw = ${typedStatement};
         const adapter = { all: (inputs: (typeof raw)[]) => Promise.all(inputs.map((input) => query(input, z.object({ value: z.int() })))) };
         adapter.all = Promise.all;
         { const [rows] = await adapter.all([raw]); return rows?.[0]?.value; }`,
      ],
      [
        0,
        `const raw = ${typedStatement};
         const adapter: { all: (input: (typeof raw)[]) => Promise<Awaited<typeof raw>[]> } = { all: Promise.all };
         adapter.all = (inputs) => Promise.all(inputs.map((input) => query(input, z.object({ value: z.int() }))));
         try { const [rows] = await adapter.all([raw]); return rows?.[0]?.value; } finally { }`,
      ],
      [
        0,
        `const raw = ${typedStatement};
         const adapter: { all: (input: (typeof raw)[]) => Promise<Awaited<typeof raw>[]> } = { all: Promise.all };
         adapter.all = (inputs) => Promise.all(inputs.map((input) => query(input, z.object({ value: z.int() }))));
         const [rows] = await adapter.all([raw]); return rows?.[0]?.value;`,
      ],
      [
        1,
        `const raw = ${typedStatement};
         const adapter = { all: (inputs: (typeof raw)[]) => Promise.all(inputs.map((input) => query(input, z.object({ value: z.int() })))) };
         adapter.all = Promise.all; const [rows] = await adapter.all([raw]); return rows?.[0]?.value;`,
      ],
      [
        1,
        `const raw = ${typedStatement}; const all = Promise.all<[typeof raw]>;
         const apply = (Reflect.apply<typeof Promise, [[typeof raw]], ReturnType<typeof all>>).bind(Reflect, all, Promise);
         const adapter = { apply }; const [rows] = await adapter.apply([[raw]]); return rows[0]?.value;`,
      ],
      [
        1,
        `const raw = ${typedStatement};
         const { all }: { all: (input: (typeof raw)[]) => Promise<Awaited<typeof raw>[]> } = Promise;
         const [rows] = await all.call(Promise, [raw]); return rows[0]?.value;`,
      ],
      [
        0,
        `const decoded = query(${typedStatement}, z.object({ value: z.int() }));
         const all = Promise.all<[typeof decoded]>;
         const apply = (Reflect.apply<typeof Promise, [[typeof decoded]], ReturnType<typeof all>>).bind(Reflect, all, Promise);
         const adapter = { apply }; const [rows] = await adapter.apply([[decoded]]); return rows[0]?.value;`,
      ],
      [1, `const [rows] = await Promise.all([${tagged}]); return rows[0];`],
      [1, `return Promise.resolve(${tagged});`],
      [
        1,
        `return z.array(availabilityEvidenceRow).parse(await Promise.resolve(availabilitySamplesFrom((strings, ...values) => client(strings, ...values), '2026-11-20T00:00:00Z')));`,
      ],
      [1, `return Promise.allSettled([${tagged}]);`],
      [1, `return globalThis.Promise.any(new Set([${tagged}]));`],
      [
        1,
        `const queries = [${tagged}] as const; const settle = Promise; return settle['race'](queries);`,
      ],
      [
        1,
        `const resolve = Promise.resolve.bind(Promise); return resolve(${tagged});`,
      ],
      [1, `return Promise.all(...[[${tagged}]] as const);`],
      [
        1,
        `function* queries() { yield ${tagged}; } return Promise.all(queries());`,
      ],
      [1, `return Promise.resolve.call(Promise, ${tagged});`],
      [1, `return Promise.all.apply(Promise, [[${tagged}]]);`],
      [
        1,
        'const raw = client<{ value: number }[]>`select 1 as value`; const [rows] = await (Promise.all<[typeof raw]>).bind(Promise, [raw])(); return rows[0]?.value;',
      ],
      [
        1,
        'const raw = client<{ value: number }[]>`select 1 as value`; return (Promise.try<Awaited<typeof raw>>).bind(Promise, () => raw)();',
      ],
      [
        1,
        'const raw = client<{ value: number }[]>`select 1 as value`; return Promise.all.call(...[Promise, [raw]] as const);',
      ],
      [1, `return Reflect.apply(Promise.all, Promise, [[${tagged}]]);`],
      [
        1,
        `const iterator: typeof Symbol.iterator = Symbol.iterator; return Promise.all({ *[iterator]() { yield ${tagged}; } });`,
      ],
      [
        1,
        `const settle = <T extends SQL.Query<unknown>>(value: T) => Promise.resolve(value); return settle(${tagged});`,
      ],
      [1, `const rows = await Promise.try(() => ${tagged}); return rows[0];`],
      [
        1,
        `return z.array(availabilityEvidenceRow).parse(await Promise.try(() => availabilitySamplesFrom((strings, ...values) => client(strings, ...values), '2026-11-20T00:00:00Z')));`,
      ],
      [
        1,
        `const raw = ${tagged}; const rows = await new Promise<Awaited<typeof raw>>((resolve) => resolve(raw)); return rows[0];`,
      ],
      [0, `return Promise.all([${parsedStatement}]);`],
      [0, `return Promise.resolve(${parsedStatement});`],
      [0, `return Promise.all.bind(Promise, [${parsedStatement}])();`],
      [
        0,
        `const rows = await Promise.try(() => ${parsedStatement}); return rows[0];`,
      ],
      [
        1,
        `function* values() { yield 1; return ${tagged}; } return Promise.all(values());`,
      ],
      [
        0,
        'const writer = async () => { await client`delete from fixture`; }; return Promise.all([writer()]);',
      ],
      [
        0,
        'const receipt = await client<{ command: string }>`commit`; return Promise.resolve(receipt.command);',
      ],
      [
        1,
        `const raw = ${typedStatement};
       const all = Promise.all<[typeof raw]>;
       const apply = (Reflect.apply<typeof Promise, [[typeof raw]], ReturnType<typeof all>>).bind(Reflect, all, Promise);
       const [rows] = await apply([[raw]]); return rows[0]?.value;`,
      ],
      [
        1,
        `const raw = ${typedStatement}; const all = Promise.all<[typeof raw]>;
       return Reflect.apply(all.bind, all, [Promise, [raw]])();`,
      ],
      [
        1,
        `const raw = ${typedStatement};
       const all: (input: Iterable<typeof raw>) => Promise<Awaited<typeof raw>[]> = Promise.all;
       const apply = (Reflect.apply<typeof Promise, [Set<typeof raw>], ReturnType<typeof all>>).bind(Reflect, all, Promise);
       const [rows] = await apply([new Set([raw])]); return rows?.[0]?.value;`,
      ],
      [
        1,
        `const raw = ${typedStatement}; const attempt = Promise.try<Awaited<typeof raw>>;
       const apply = (Reflect.apply<typeof Promise, [() => typeof raw], ReturnType<typeof attempt>>).bind(Reflect, attempt, Promise);
       const rows = await apply([() => raw]); return rows[0]?.value;`,
      ],
      [
        1,
        `const raw = ${typedStatement}; const all = Promise.all<[typeof raw, [typeof raw]]>;
       const apply = (Reflect.apply<typeof Promise, [[typeof raw, [typeof raw]]], ReturnType<typeof all>>).bind(Reflect, all, Promise);
       const [rows] = await apply([[raw, [raw]]]); return rows[0]?.value;`,
      ],
      [
        1,
        `const raw = ${typedStatement};
       const all: (input: Set<typeof raw>) => Promise<Awaited<typeof raw>[]> = Promise.all;
       const invoke: (target: typeof all, receiver: typeof Promise, args: [Set<typeof raw>]) => ReturnType<typeof all> = Reflect.apply;
       const [rows] = await invoke(all, Promise, [new Set([raw])]); return rows?.[0]?.value;`,
      ],
      [
        1,
        `const raw = ${typedStatement};
       const all: (input: Set<typeof raw>) => Promise<Awaited<typeof raw>[]> = Promise.all;
       const args = [Reflect, all, Promise] as const;
       const apply = (Reflect.apply<typeof Promise, [Set<typeof raw>], ReturnType<typeof all>>).bind(...args);
       const [rows] = await apply([new Set([raw])]); return rows?.[0]?.value;`,
      ],
      [1, `return Promise.resolve().then(() => ${typedStatement});`],
      [
        0,
        `const parsed = query(${typedStatement}, z.object({ value: z.int() }));
       const all = Promise.all<[typeof parsed]>;
       const apply = (Reflect.apply<typeof Promise, [[typeof parsed]], ReturnType<typeof all>>).bind(Reflect, all, Promise);
       const [rows] = await apply([[parsed]]); return rows[0]?.value;`,
      ],
      [
        0,
        'const discard = async (connection: SQL) => { await connection`delete from fixture`; }; await discard(client);',
      ],
      [
        0,
        `const raw = ${typedStatement}; const decode = async (inputs: Set<typeof raw>) =>
         Promise.all([...inputs].map((input) => query(input, z.object({ value: z.int() }))));
       return decode(new Set([raw]));`,
      ],
      [
        0,
        `const raw = ${typedStatement}; const keep = (inputs: Set<typeof raw>) => inputs;
       const preserved = Reflect.apply(keep, undefined, [new Set([raw])]);
       for (const input of preserved) return query(input, z.object({ value: z.int() }));
       return [];`,
      ],
      [
        0,
        `const raw = ${typedStatement}; const [input] = await Promise.resolve([raw] as const);
       return query(input, z.object({ value: z.int() }));`,
      ],
      [
        1,
        'const raw = ' +
          typedStatement +
          '; const all: (input: (typeof raw)[]) => Promise<Awaited<typeof raw>[]> = Promise.all; const settle = all.bind(Promise); const [rows] = await settle([raw]); return rows?.[0]?.value;',
      ],
      [
        1,
        'const raw = ' +
          typedStatement +
          '; const all: (input: Set<typeof raw>) => Promise<Awaited<typeof raw>[]> = Promise.all; const settle = all.bind(Promise); const [rows] = await settle(new Set([raw])); return rows?.[0]?.value;',
      ],
      [
        1,
        'const raw = ' +
          typedStatement +
          '; const all: (input: (typeof raw)[]) => Promise<Awaited<typeof raw>[]> = Promise.all; const apply = Reflect.apply<typeof Promise, [(typeof raw)[]], ReturnType<typeof all>>; const [rows] = await apply.call(Reflect, all, Promise, [[raw]]); return rows?.[0]?.value;',
      ],
      [
        1,
        'const raw = ' +
          typedStatement +
          '; const all = Promise.all<[typeof raw]>; const apply = (Reflect.apply<typeof Promise, [[typeof raw]], ReturnType<typeof all>>).bind(Reflect, all, Promise); const [rows] = await apply.call(undefined, [[raw]]); return rows[0]?.value;',
      ],
      [
        1,
        'const raw = ' +
          typedStatement +
          '; const all = Promise.all<[typeof raw]>; const apply = (Reflect.apply<typeof Promise, [[typeof raw]], ReturnType<typeof all>>).bind(Reflect, all, Promise); const [rows] = await Reflect.apply(apply, undefined, [[[raw]]]); return rows[0]?.value;',
      ],
      [
        0,
        'const decoded = query(' +
          typedStatement +
          ', z.object({ value: z.int() })); const all = Promise.all<[typeof decoded]>; const apply = (Reflect.apply<typeof Promise, [[typeof decoded]], ReturnType<typeof all>>).bind(Reflect, all, Promise); const [rows] = await Reflect.apply(apply, undefined, [[[decoded]]]); return rows[0]?.value;',
      ],
    ] as const;
    const cases = [
      ...directCases,
      ...settlementCases.map(
        ([expected, body]) =>
          [expected, source(body, imports), feature] as const,
      ),
    ];
    const mismatches = (
      await Promise.all(
        cases.map(async ([expected, code, filePath]) => {
          const [result] = await lint.lintText(code, { filePath });
          const actual =
            result?.messages.filter(({ ruleId }) => ruleId === rule).length ??
            0;
          return { code, filePath, expected, actual };
        }),
      )
    ).filter(({ expected, actual }) => expected !== actual);
    assert({
      given:
        'native reads, composed Promise settlement and preserved decoder controls',
      should: 'report exactly the unvalidated reads',
      actual: mismatches,
      expected: [],
    });
  });
});

describe('browser edges', () => {
  const rule = 'daisy-client/browser-edge';
  const probe = async (filePath: string, source: string) => {
    const [result] = await repositoryEslint().lintText(source, { filePath });
    return result.messages.filter(({ ruleId }) => ruleId === rule).length;
  };

  test('owns React effects and host calls', async () => {
    assert({
      given:
        'aliased imports, namespace effects, direct and bracket host calls',
      should: 'report each bypass',
      actual: await probe(
        web('ui/room/controls.tsx'),
        `import React, { useEffect as reactEffect } from 'react';
         export { useLayoutEffect } from 'react';
         reactEffect(() => {}, []);
         React.useLayoutEffect(() => {}, []);
         setTimeout(() => {}, 10);
         window['clearTimeout'](1);
         void globalThis.fetch('/api/rooms');`,
      ),
      expected: 6,
    });
  });

  test('reports destructuring and React references above their import', async () => {
    assert({
      given:
        'an extracted timer and a namespace effect before its hoisted import',
      should: 'report both paths to runtime effects',
      actual: await probe(
        web('ui/room/controls.tsx'),
        `const { setTimeout: schedule } = window;
         schedule(() => {}, 1);
         React.useEffect(() => {}, []);
         import * as React from 'react';
         export const { useLayoutEffect: syncLayout } = React;`,
      ),
      expected: 3,
    });
  });

  test('reports browser and React defaults while allowing injected ports', async () => {
    assert({
      given:
        'destructured global defaults and locally injected window and React objects',
      should: 'report the host defaults and respect the local bindings',
      actual: await probe(
        web('ui/room/controls.tsx'),
        `import * as React from 'react';
         export function schedule({ setTimeout: delay } = window) {
           return delay(() => {}, 1);
         }
         export function useSchedule({ useEffect: onEffect } = React) {
           onEffect(() => {}, []);
         }
         export function injected(
           window: Pick<Window, 'setTimeout'>,
           React: { useEffect: () => void },
         ) {
           const { setTimeout: delay } = window;
           const { useEffect: onEffect } = React;
           delay(() => {}, 1);
           onEffect();
         }`,
      ),
      expected: 2,
    });
  });

  test('keeps the browser transport out of server process composition', async () => {
    assert({
      given:
        'a server module that statically imports, reexports or dynamically imports the browser adapter',
      should:
        'report each cross-boundary module dependency and the aliased port',
      actual: await probe(
        web('server/probe.ts'),
        `import { browserTransport } from '../ui/edge/browser-request';
         export { browserTransport as transport } from '../ui/edge/browser-request';
         export const read = () => import('../ui/edge/browser-request');
         export const fetcher = browserTransport;`,
      ),
      expected: 4,
    });
  });

  test('refuses a re-exported effect under any name, the edge included', async () => {
    assert({
      given:
        'the edge and a feature module re-exporting React effects by alias, by binding and wholesale',
      should: 'report each re-export',
      actual: await Promise.all([
        probe(
          web('ui/edge/browser-sync.ts'),
          `export {
             useEffect as useBrowserEffect,
             useLayoutEffect as useBrowserLayoutEffect,
           } from 'react';`,
        ),
        probe(
          web('ui/edge/lifetime.ts'),
          `import * as React from 'react';
           import { useEffect } from 'react';
           export { useEffect as useLifetime };
           export const useLayout = React.useLayoutEffect;
           export const usePassive = useEffect;`,
        ),
        probe(web('ui/room/hooks.ts'), `export * from 'react';`),
      ]),
      expected: [2, 3, 1],
    });
  });

  test('refuses a hook that takes an arbitrary effect', async () => {
    assert({
      given: 'an edge hook typed with React’s effect callback and dependencies',
      should: 'report the effect types, imported or namespaced',
      actual: await probe(
        web('ui/edge/use-mount.ts'),
        `import * as React from 'react';
         import { useEffect, type EffectCallback, type DependencyList } from 'react';
         export function useMount(start: EffectCallback, deps: DependencyList) {
           useEffect(start, deps);
         }
         export const useLater = (start: React.EffectCallback) => useEffect(start);`,
      ),
      expected: 3,
    });
  });

  test('injects the timer and request ports instead of calling them', async () => {
    assert({
      given:
        'a component calling, and a driver composition passing, the browser ports',
      should: 'report only the calls',
      actual: await probe(
        web('ui/room/controls.tsx'),
        `import { browserScheduler } from '../edge/browser-time';
         import { browserTransport } from '../edge/browser-request';
         import * as time from '../edge/browser-time';
         browserScheduler.after(() => {}, 10);
         void browserTransport('/api/rooms');
         time.browserScheduler.every(() => {}, 10);
         export const driver = createDriver({ fetch: browserTransport, scheduler: browserScheduler });`,
      ),
      expected: 3,
    });
  });

  test('refuses a port called through an alias, a destructure or a default', async () => {
    assert({
      given:
        'a port aliased, destructured, defaulted as a parameter, and one handed on as an argument and a property',
      should: 'report the three uses and allow the two hand-offs',
      actual: await probe(
        web('ui/room/controls.tsx'),
        `import { browserScheduler } from '../edge/browser-time';
         import { browserTransport } from '../edge/browser-request';
         const s = browserScheduler;
         const { every } = browserScheduler;
         export const read = (transport = browserTransport) => transport('/x');
         export const poll = startPoll(browserScheduler.after);
         export const client = createClient({ fetch: browserTransport });
         void s; void every;`,
      ),
      expected: 3,
    });
  });

  test('refuses an edge hook handed a dependency list instead of its value', async () => {
    assert({
      given:
        'a zero-parameter handler, an unused parameter, a template-literal key, a JSON.stringify key and an array key',
      should:
        'report each, and allow a job acting on its value or an answer’s arrival',
      actual: await Promise.all([
        probe(
          web('ui/room/controls.tsx'),
          `import { useDeliver } from '../edge/use-answer';
           import { useResource } from '../edge/use-driver';
           export function useMarks(a: string, b: number) {
             useDeliver(a, () => mark());
             useResource(a, (unused) => open());
             useDeliver(\`\${a}|\${b}\`, (key) => mark(key));
             useDeliver(JSON.stringify([a, b]), (key) => mark(key));
             useResource([a, b], (key) => open(key));
           }`,
        ),
        probe(
          web('ui/room/controls.tsx'),
          `import { useAnswer, useDeliver } from '../edge/use-answer';
           import { useResource } from '../edge/use-driver';
           export function useMarks(mark: Mark, answer: Answer, onAnswer: () => void) {
             useDeliver(mark, (shown) => send(shown.sequence));
             useResource(mark, ({ channelId }) => open(channelId));
             useDeliver(answer, report);
             useAnswer(answer, () => onAnswer());
           }`,
        ),
      ]),
      expected: [5, 0],
    });
  });

  test('refuses a memoised value whose fields only re-fire the job', async () => {
    assert({
      given:
        'memoised values with a field the handler never reads: by destructure, by member, with no parameter, as an array, from a block body and through a named handler',
      should:
        'report each, and allow a value whose every field the job reads or a prop handler it cannot read',
      actual: await Promise.all([
        probe(
          web('ui/room/controls.tsx'),
          `import { useMemo } from 'react';
           import { useAnswer, useDeliver } from '../edge/use-answer';
           export function useBar(reader: Reader, path: string, seed: number) {
             const view = useMemo(() => ({ reader, path, seed }), [reader, path, seed]);
             useDeliver(view, ({ reader }) => reader.read());
             const shown = useMemo(() => ({ reader, path }), [reader, path]);
             useDeliver(shown, (value) => value.reader.read());
             const moved = useMemo(() => ({ path }), [path]);
             useAnswer(moved, () => refresh());
             const pair = useMemo(() => [reader, path] as const, [reader, path]);
             useDeliver(pair, ([r]) => r.read());
             const block = useMemo(() => {
               return { reader, path };
             }, [reader, path]);
             useDeliver(block, ({ reader }) => reader.read());
             const bag = useMemo(() => ({ reader, seed }), [reader, seed]);
             function handle(value: { reader: Reader }) {
               value.reader.read();
             }
             useDeliver(bag, handle);
           }`,
        ),
        probe(
          web('ui/room/controls.tsx'),
          `import { useMemo } from 'react';
           import { useDeliver } from '../edge/use-answer';
           export function useMark(channelId: string, sequence: number) {
             const mark = useMemo(() => ({ channelId, sequence }), [channelId, sequence]);
             useDeliver(mark, ({ channelId, sequence }) => send(channelId, sequence));
           }
           export function Bar({ a, onShown }: { a: number; onShown: (v: unknown) => void }) {
             const v = useMemo(() => ({ a, b: 2 }), [a]);
             useDeliver(v, onShown);
             return null;
           }`,
        ),
      ]),
      expected: [6, 0],
    });
  });

  test('a port inside an object or array is handed on only as an argument', async () => {
    assert({
      given:
        'ports bound into a local object and array then used, a browser wait called, and ports in an argument literal',
      should:
        'report the bound ports and the wait call, and allow the argument',
      actual: await Promise.all([
        probe(
          web('ui/messaging/mark-read.tsx'),
          `import { browserScheduler } from '../edge/browser-time';
           import { browserTransport } from '../edge/browser-request';
           import { pause } from '../edge/browser-waits';
           const ports = { s: browserScheduler, t: browserTransport };
           ports.s.after(run, 10);
           const [t2] = [browserTransport];
           void t2('/y');
           void pause(5);`,
        ),
        probe(
          web('ui/messaging/mark-read.tsx'),
          `import { browserScheduler } from '../edge/browser-time';
           import { browserTransport } from '../edge/browser-request';
           import { pause } from '../edge/browser-waits';
           export const driver = createDriver({
             ports: { wait: browserScheduler.after, fetch: browserTransport },
             waits: [pause],
           });`,
        ),
      ]),
      expected: [4, 0],
    });
  });

  test('accepts the owner, injected ports and a server request', async () => {
    assert({
      given: 'edge code, a client’s injected ports and a server’s fetch',
      should: 'allow each',
      actual: await Promise.all([
        probe(web('ui/edge/probe.ts'), 'void fetch("/endpoint");'),
        probe(
          web('ui/probe.ts'),
          'export const read = (fetch: () => void) => fetch();',
        ),
        probe(web('server/probe.ts'), 'void fetch("https://example.test");'),
      ]),
      expected: [0, 0, 0],
    });
  });
});
