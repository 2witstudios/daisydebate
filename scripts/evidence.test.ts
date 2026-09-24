import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  ciGateProblems,
  ciInvokedTasks,
  classifyTestFile,
  integrationGuardProblems,
  isTestFilePath,
  rootClaimProblems,
} from './evidence';

setupRitewayBun();

describe('isTestFilePath', () => {
  test('recognizes the three suite suffixes and nothing else', () => {
    assert({
      given: 'unit, integration, e2e, and non-test paths',
      should: 'classify only suite files',
      actual: [
        'packages/db/src/index.test.ts',
        'packages/db/integration/db.integration.ts',
        'apps/web/e2e/app.e2e.ts',
        'packages/db/src/index.ts',
        'README.md',
      ].map(isTestFilePath),
      expected: [true, true, true, false, false],
    });
  });

  test('sees TSX suites so they cannot hide from the gate', () => {
    assert({
      given: 'React component, integration, and e2e suites written in TSX',
      should: 'treat every one as a suite file, and a plain component as not',
      actual: [
        'apps/web/src/ui/store/store.test.tsx',
        'apps/web/src/ui/store/store.integration.tsx',
        'apps/web/e2e/app.e2e.tsx',
        'apps/web/src/ui/store/store.tsx',
      ].map(isTestFilePath),
      expected: [true, true, true, false],
    });
  });
});

describe('classifyTestFile', () => {
  test('routes each suite to its claiming runner', () => {
    assert({
      given: 'one file per tier',
      should: 'assign the tier whose runner claims it',
      actual: {
        unit: classifyTestFile('packages/protocol/src/index.test.ts'),
        rootScript: classifyTestFile('scripts/doctor.test.ts'),
        rootConfig: classifyTestFile('eslint.config.test.ts'),
        integration: classifyTestFile(
          'apps/web/integration/foundation.integration.ts',
        ),
        e2e: classifyTestFile('apps/web/e2e/app.e2e.ts'),
      },
      expected: {
        unit: 'unit',
        rootScript: 'root-script',
        rootConfig: 'root-config',
        integration: 'integration',
        e2e: 'e2e',
      },
    });
  });

  test('flags suites outside claimed locations as orphans', () => {
    assert({
      given: 'a test file at a package root instead of src/',
      should: 'mark it an orphan',
      actual: classifyTestFile('packages/db/misplaced.test.ts'),
      expected: 'orphan',
    });
  });

  test('claims TSX unit suites wherever bun test executes them', () => {
    assert({
      given: '.test.tsx files under a workspace src/ and under root scripts/',
      should: 'assign the tier of the bun test runner that globs them',
      actual: [
        'apps/web/src/ui/components/nav-item/nav-item.render.test.tsx',
        'apps/web/src/ui/store/store.test.tsx',
        'scripts/report.test.tsx',
      ].map(classifyTestFile),
      expected: ['unit', 'unit', 'root-script'],
    });
  });

  test('flags a TSX unit suite outside claimed locations as an orphan', () => {
    assert({
      given: 'a .test.tsx file beside src/ instead of inside it',
      should: 'mark it an orphan',
      actual: classifyTestFile('apps/web/components/button.test.tsx'),
      expected: 'orphan',
    });
  });

  test('flags integration and e2e suffixes under src/ as orphans', () => {
    assert({
      given:
        'an .integration.ts and an .e2e.ts under a workspace src/, which bun test src never globs',
      should: 'mark both orphans instead of counting them as unit suites',
      actual: [
        'packages/db/src/foo.integration.ts',
        'packages/db/src/foo.e2e.ts',
      ].map(classifyTestFile),
      expected: ['orphan', 'orphan'],
    });
  });

  test('keeps real integration and e2e directories claimed', () => {
    assert({
      given: 'suites under integration/ and apps/web/e2e/',
      should: 'stay claimed by their own runners',
      actual: [
        'packages/db/integration/db.integration.ts',
        'packages/db/integration/seed.integration.ts',
        'apps/web/e2e/app.e2e.ts',
      ].map(classifyTestFile),
      expected: ['integration', 'integration', 'e2e'],
    });
  });

  test('flags TSX suites no runner globs as orphans', () => {
    assert({
      given:
        'an .e2e.tsx outside the Playwright testMatch and an .integration.tsx outside the bun test src glob',
      should: 'mark both orphans instead of counting them as claimed',
      actual: [
        'apps/web/e2e/app.e2e.tsx',
        'apps/web/src/ui/store/store.integration.tsx',
      ].map(classifyTestFile),
      expected: ['orphan', 'orphan'],
    });
  });
});

describe('integrationGuardProblems', () => {
  const guarded = [
    "import { requireTestServices } from '@daisy/config';",
    'const { databaseUrl } = requireTestServices(process.env);',
  ].join('\n');
  const codes = (content: string) =>
    integrationGuardProblems(content, 'db.integration.ts').map(
      ({ code }) => code,
    );

  test('accepts a suite that imports and calls the shared guard at load', () => {
    assert({
      given:
        "a suite calling @daisy/config's requireTestServices at module scope",
      should: 'report no problems',
      actual: codes(guarded),
      expected: [],
    });
  });

  test('accepts the guard under a local alias', () => {
    assert({
      given: 'an aliased import of requireTestServices, called at load',
      should: 'report no problems',
      actual: codes(
        [
          "import { requireTestServices as services } from '@daisy/config';",
          'const urls = services(process.env);',
        ].join('\n'),
      ),
      expected: [],
    });
  });

  test('flags a hand-written guard that only mentions the variables', () => {
    assert({
      given: 'a copied text guard that reads TEST_DATABASE_URL and throws',
      should: 'fail with GUARD_MISSING: the shared import is the contract',
      actual: codes(
        [
          'const url = process.env.TEST_DATABASE_URL;',
          "if (!url) throw new Error('TEST_DATABASE_URL required');",
        ].join('\n'),
      ),
      expected: ['GUARD_MISSING'],
    });
  });

  test('flags a guard named only in a comment or a string', () => {
    assert({
      given: 'text that names requireTestServices without importing it',
      should: 'fail with GUARD_MISSING',
      actual: codes(
        [
          "// import { requireTestServices } from '@daisy/config';",
          "const note = 'requireTestServices(process.env)';",
        ].join('\n'),
      ),
      expected: ['GUARD_MISSING'],
    });
  });

  test('flags an imported guard that is never called at load', () => {
    assert({
      given: 'the import alone, and a call deferred into a test body',
      should:
        'fail both with GUARD_MISSING: nothing throws when the file loads',
      actual: [
        codes("import { requireTestServices } from '@daisy/config';"),
        codes(
          [
            "import { requireTestServices } from '@daisy/config';",
            "test('x', () => { requireTestServices(process.env); });",
          ].join('\n'),
        ),
      ],
      expected: [['GUARD_MISSING'], ['GUARD_MISSING']],
    });
  });

  test('accepts the guard as a top-level declaration or statement only', () => {
    assert({
      given:
        'the guard as a top-level expression statement and as a const initializer',
      should: 'report no problems for either',
      actual: [
        codes(
          [
            "import { requireTestServices } from '@daisy/config';",
            'requireTestServices(process.env);',
          ].join('\n'),
        ),
        codes(guarded),
      ],
      expected: [[], []],
    });
  });

  test('flags a guard call that may never run or checks something else', () => {
    const probe = (call: string) =>
      codes(
        ["import { requireTestServices } from '@daisy/config';", call].join(
          '\n',
        ),
      );
    assert({
      given:
        'a guard behind an if, a swallowed try, a short-circuit, an optional call, literal values, and a nested block',
      should: 'fail every one with GUARD_MISSING: none must throw at load',
      actual: [
        probe('if (process.env.CI) requireTestServices(process.env);'),
        probe('try { requireTestServices(process.env); } catch {}'),
        probe('process.env.SKIP || requireTestServices(process.env);'),
        probe('requireTestServices?.(process.env);'),
        probe(
          "requireTestServices({ TEST_DATABASE_URL: 'postgres://x/y_test', TEST_REDIS_URL: 'redis://x' });",
        ),
        probe('{ requireTestServices(process.env); }'),
        probe(
          'const services = hasServices && requireTestServices(process.env);',
        ),
      ],
      expected: Array.from({ length: 7 }, () => ['GUARD_MISSING']),
    });
  });

  test('flags a same-named guard from another module', () => {
    assert({
      given: 'requireTestServices imported from a local helper',
      should: 'fail with GUARD_MISSING: only the shared guard counts',
      actual: codes(
        [
          "import { requireTestServices } from './helpers';",
          'requireTestServices(process.env);',
        ].join('\n'),
      ),
      expected: ['GUARD_MISSING'],
    });
  });
});

const wiredScripts = {
  test: 'bun test scripts && turbo run test',
  lint: 'eslint . && bun scripts/check-styling.ts && bun test eslint.config.test.ts',
  check:
    'bun run policy && bun run knip && bun run duplication && bun run invariants && bun run evidence',
};

describe('rootClaimProblems', () => {
  test('accepts a check chain that runs every root gate', () => {
    assert({
      given: 'root scripts that invoke every claimed gate',
      should: 'report nothing',
      actual: rootClaimProblems(wiredScripts),
      expected: [],
    });
  });

  test('flags a check chain that drops the duplication gate', () => {
    assert({
      given: 'a check script without the duplication gate',
      should: 'fail with UNRUN_SUITE naming the missing gate',
      actual: rootClaimProblems({
        ...wiredScripts,
        check: 'bun run policy && bun run invariants && bun run evidence',
      }),
      expected: [
        {
          code: 'UNRUN_SUITE',
          detail:
            'root "check" script does not invoke duplication; the corresponding suites would not run in bun check',
        },
      ],
    });
  });
});

// Shaped like the real ci.yml: a multi-line flow-sequence matrix driven by
// `bun run ${{ matrix.task }}`, plus a job that invokes one gate directly.
const wiredWorkflow = [
  'jobs:',
  '  checks:',
  '    strategy:',
  '      matrix:',
  '        task:',
  '          [',
  '            policy,',
  '            knip, # dead code',
  '            duplication, ',
  '            invariants,',
  '            evidence,',
  '          ]',
  '    steps:',
  '      - run: bun install --frozen-lockfile',
  '      - run: bun run ${{ matrix.task }}',
  '  migrations:',
  '    steps:',
  '      - run: bun migrations:check',
].join('\n');

describe('ciInvokedTasks', () => {
  test('reads matrix entries and direct bun invocations', () => {
    assert({
      given: 'a workflow with a multi-line matrix and a direct gate step',
      should: 'return every task CI actually invokes, without comments',
      actual: ciInvokedTasks(wiredWorkflow),
      expected: [
        'policy',
        'knip',
        'duplication',
        'invariants',
        'evidence',
        'install',
        'migrations:check',
      ],
    });
  });

  test('reads inline and block-sequence matrices', () => {
    assert({
      given: 'an inline flow matrix and a block-sequence matrix',
      should: 'extract the same entries from both shapes',
      actual: [
        ciInvokedTasks(
          'task: [knip, policy]\n- run: bun run ${{ matrix.task }}',
        ),
        ciInvokedTasks(
          'task:\n  - knip\n  - policy\nsteps:\n  - run: bun run ${{ matrix.task }}',
        ),
      ],
      expected: [
        ['knip', 'policy'],
        ['knip', 'policy'],
      ],
    });
  });

  test('ignores a matrix that no step executes', () => {
    assert({
      given: 'a task matrix without a step running matrix.task',
      should: 'count none of its entries as invoked',
      actual: ciInvokedTasks('task: [knip, policy]\nsteps:\n  - run: bun lint'),
      expected: ['lint'],
    });
  });
});

describe('ciGateProblems', () => {
  test('accepts a workflow that runs every gate', () => {
    assert({
      given: 'a ci.yml naming every required gate',
      should: 'report nothing',
      actual: ciGateProblems(wiredWorkflow),
      expected: [],
    });
  });

  test('flags a workflow that drops the duplication gate', () => {
    assert({
      given: 'a ci.yml whose matrix no longer lists duplication',
      should: 'fail with UNRUN_SUITE naming the gate',
      actual: ciGateProblems(
        wiredWorkflow.replace('            duplication, \n', ''),
      ),
      expected: [
        {
          code: 'UNRUN_SUITE',
          detail:
            'ci.yml does not run duplication; the gate would silently stop running in CI',
        },
      ],
    });
  });

  test('flags every gate when the workflow is missing', () => {
    assert({
      given: 'no ci.yml at all',
      should: 'report each required gate as unrun',
      actual: ciGateProblems(undefined).map(({ detail }) =>
        detail.replace(/^ci\.yml does not run (\S+);.*$/, '$1'),
      ),
      expected: [
        'knip',
        'policy',
        'duplication',
        'invariants',
        'evidence',
        'migrations:check',
      ],
    });
  });

  test('rejects a gate that is only mentioned in a comment', () => {
    assert({
      given: 'a matrix without duplication and a comment naming it',
      should: 'fail, because a comment runs nothing',
      actual: ciGateProblems(
        wiredWorkflow.replace(
          '            duplication, \n',
          '            # duplication, (temporarily disabled)\n',
        ),
      ).map(({ detail }) => detail),
      expected: [
        'ci.yml does not run duplication; the gate would silently stop running in CI',
      ],
    });
  });

  test('does not mistake a comment for a duplicated browser suite', () => {
    assert({
      given: 'a comment explaining that e2e.yml owns test:e2e',
      should: 'report nothing',
      actual: ciGateProblems(
        `${wiredWorkflow}\n      # bun test:e2e lives in e2e.yml`,
      ),
      expected: [],
    });
  });

  test('keeps e2e.yml the single browser-suite owner', () => {
    assert({
      given: 'a ci.yml that also runs test:e2e',
      should: 'fail with E2E_DUPLICATED',
      actual: ciGateProblems(`${wiredWorkflow}\n      - run: bun test:e2e`).map(
        ({ code }) => code,
      ),
      expected: ['E2E_DUPLICATED'],
    });
  });
});
