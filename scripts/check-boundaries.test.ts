import {
  adobeBanIssue,
  isAdobePackage,
  manifestDependencyFields,
  allowedWorkspaceDependencies,
  deepImportIssue,
  forbiddenDependencyIssue,
  operatorApiIssue,
} from './boundaries-rules';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { moduleLoads } from './module-loads';

setupRitewayBun();

const workspaces = [
  '@daisy/web',
  '@daisy/debate-engine',
  '@daisy/protocol',
  '@daisy/db',
  '@daisy/redis',
  '@daisy/auth',
  '@daisy/ingress',
  '@daisy/errors',
  '@daisy/config',
  '@daisy/clock',
  '@daisy/logger',
  '@daisy/observability',
  '@daisy/typescript-config',
] as const;

describe('Adobe ban (ADR 0911)', () => {
  for (const name of [...workspaces, '@daisy/debate-engine', 'package.json'])
    test(`${name} may neither declare nor load an @adobe package`, () => {
      assert({
        given: `${name} declaring @adobe/data and loading @adobe/data/ecs`,
        should: 'report both as banned',
        actual: [
          adobeBanIssue(name, '@adobe/data', 'dependency'),
          adobeBanIssue(name, '@adobe/data/ecs', 'import'),
        ],
        expected: [
          `${name}: Adobe dependency @adobe/data is banned (ADR 0911)`,
          `${name}: Adobe import @adobe/data/ecs is banned (ADR 0911)`,
        ],
      });
    });

  test('every spelling the compiler reads as a module load is found', () => {
    const source = [
      "import { Database } from '@adobe/data/ecs';",
      "export { Schema } from '@adobe/data/schema';",
      "type Plugin = import('@adobe/data').Plugin;",
      "import ecs = require('@adobe/data/ecs');",
      "const late = await import(('@adobe/data' as string));",
      'const escaped = require(`\\u0040adobe/data`);',
      "declare module '@adobe/data-react' {}",
      "const name = '@adobe/data'; // data, not a load",
      "import { other } from '@adobe-not/data';",
    ].join('\n');
    assert({
      given:
        'seven module loads of Adobe packages, a string and a lookalike scope',
      should: 'find exactly the seven loads',
      actual: moduleLoads('scripts/probe.ts', source, isAdobePackage).map(
        ({ specifier }) => specifier.text,
      ),
      expected: [
        '@adobe/data/ecs',
        '@adobe/data/schema',
        '@adobe/data',
        '@adobe/data/ecs',
        '@adobe/data',
        '@adobe/data',
        '@adobe/data-react',
      ],
    });
  });

  test('non-Adobe specifiers are never flagged', () => {
    assert({
      given: 'other packages, including a lookalike scope',
      should: 'report no issue',
      actual: [
        adobeBanIssue('@daisy/db', 'drizzle-orm', 'dependency'),
        adobeBanIssue('@daisy/protocol', 'zod', 'import'),
        adobeBanIssue('@daisy/web', '@adobe-not/data', 'import'),
      ],
      expected: [null, null, null],
    });
  });

  test('every dependency field of a manifest is read', () => {
    assert({
      given: 'the manifest fields the ban reads',
      should: 'name every field that declares a package',
      actual: [...manifestDependencyFields],
      expected: [
        'dependencies',
        'devDependencies',
        'peerDependencies',
        'optionalDependencies',
      ],
    });
  });
});

describe('realtime workspace edges (ADR 0031 §12)', () => {
  test('the allowlist names exactly the twelve adopted realtime edges', () => {
    assert({
      given: 'allowedWorkspaceDependencies.realtime',
      should: 'list exactly the twelve edges including shared SHA3-256',
      actual: [...allowedWorkspaceDependencies.realtime!].sort(),
      expected: [
        'auth',
        'clock',
        'config',
        'db',
        'digest',
        'errors',
        'ingress',
        'logger',
        'observability',
        'presence',
        'protocol',
        'redis',
      ].sort(),
    });
  });

  test('a realtime manifest depending on debate-engine is forbidden', () => {
    assert({
      given: 'apps/realtime declaring @daisy/debate-engine',
      should: 'report a forbidden dependency',
      actual: forbiddenDependencyIssue(
        'apps/realtime',
        '@daisy/realtime',
        '@daisy/debate-engine',
        allowedWorkspaceDependencies,
      ),
      expected: 'apps/realtime: forbidden dependency @daisy/debate-engine',
    });
  });

  test('a realtime manifest depending on apps/web is forbidden', () => {
    assert({
      given: 'apps/realtime declaring @daisy/web',
      should: 'report a forbidden dependency',
      actual: forbiddenDependencyIssue(
        'apps/realtime',
        '@daisy/realtime',
        '@daisy/web',
        allowedWorkspaceDependencies,
      ),
      expected: 'apps/realtime: forbidden dependency @daisy/web',
    });
  });

  test('a realtime manifest depending on one of its allowed edges is not flagged', () => {
    assert({
      given: 'apps/realtime declaring @daisy/protocol',
      should: 'report no issue',
      actual: forbiddenDependencyIssue(
        'apps/realtime',
        '@daisy/realtime',
        '@daisy/protocol',
        allowedWorkspaceDependencies,
      ),
      expected: null,
    });
  });

  test('deleting the realtime key removes the restriction entirely', () => {
    const withoutRealtime = Object.fromEntries(
      Object.entries(allowedWorkspaceDependencies).filter(
        ([key]) => key !== 'realtime',
      ),
    );

    assert({
      given: 'the realtime key removed from allowedWorkspaceDependencies',
      should:
        'no longer forbid @daisy/debate-engine, proving the fixture is load-bearing',
      actual: forbiddenDependencyIssue(
        'apps/realtime',
        '@daisy/realtime',
        '@daisy/debate-engine',
        withoutRealtime,
      ),
      expected: null,
    });
  });
});

describe('workspace deep imports', () => {
  const exportsOf = (name: string) =>
    name === '@daisy/errors'
      ? { '.': './src/index.ts', './testing': './src/testing.ts' }
      : { '.': './src/index.ts' };

  test('admits a package root and a subpath the package exports', () => {
    assert({
      given: "a package's root and a subpath named in its exports map",
      should: 'report no issue for either',
      actual: [
        deepImportIssue('@daisy/errors', exportsOf),
        deepImportIssue('@daisy/errors/testing', exportsOf),
      ],
      expected: [null, null],
    });
  });

  test('refuses a subpath the package does not export', () => {
    assert({
      given: 'a reach into a source file the exports map does not name',
      should: 'report the deep import',
      actual: [
        deepImportIssue('@daisy/errors/src/index', exportsOf),
        deepImportIssue('@daisy/db/schema', exportsOf),
      ],
      expected: [
        'workspace deep import @daisy/errors/src/index',
        'workspace deep import @daisy/db/schema',
      ],
    });
  });

  test('ignores packages outside the workspace', () => {
    assert({
      given: 'a subpath import of a third-party package',
      should: 'leave it to the dependency rules',
      actual: deepImportIssue('drizzle-orm/pg-core', exportsOf),
      expected: null,
    });
  });
});

test('authorization consumes protocol while adapters stay outside its boundary', () => {
  assert({
    given: 'the accepted AZC inward vocabulary edge and forbidden adapters',
    should: 'allow protocol and still refuse db, Redis and web dependencies',
    actual: ['protocol', 'db', 'redis', 'web'].map((dependency) =>
      forbiddenDependencyIssue(
        'packages/auth',
        '@daisy/auth',
        `@daisy/${dependency}`,
        allowedWorkspaceDependencies,
      ),
    ),
    expected: [
      null,
      'packages/auth: forbidden dependency @daisy/db',
      'packages/auth: forbidden dependency @daisy/redis',
      'packages/auth: forbidden dependency @daisy/web',
    ],
  });
});

describe('admin workspace edges (ADR 0077)', () => {
  test('the admin app may never depend on the participant adapters', () => {
    assert({
      given: 'apps/admin declaring @daisy/db, @daisy/redis or @daisy/web',
      should: 'forbid each one',
      actual: ['@daisy/db', '@daisy/redis', '@daisy/web'].map((dependency) =>
        forbiddenDependencyIssue(
          'apps/admin',
          '@daisy/admin',
          dependency,
          allowedWorkspaceDependencies,
        ),
      ),
      expected: [
        'apps/admin: forbidden dependency @daisy/db',
        'apps/admin: forbidden dependency @daisy/redis',
        'apps/admin: forbidden dependency @daisy/web',
      ],
    });
  });

  test('the admin app may depend on its declared edges', () => {
    assert({
      given: 'apps/admin declaring @daisy/protocol',
      should: 'report no issue',
      actual: forbiddenDependencyIssue(
        'apps/admin',
        '@daisy/admin',
        '@daisy/protocol',
        allowedWorkspaceDependencies,
      ),
      expected: null,
    });
  });
});

describe('operatorApiIssue (ADR 0079)', () => {
  test('a Next route may not import the private operator API', () => {
    assert({
      given:
        'a page importing the operator router, the server composing it, and a page importing another feature',
      should: 'flag only the page that reaches into the operator API',
      actual: [
        operatorApiIssue(
          '../../features/operator-api/router',
          'apps/web/src/app/(shell)/page.tsx',
        ) !== null,
        operatorApiIssue(
          '../features/operator-api/router',
          'apps/web/src/server/operator-api.ts',
        ),
        operatorApiIssue(
          '../../features/access/decision',
          'apps/web/src/app/(shell)/page.tsx',
        ),
      ],
      expected: [true, null, null],
    });
  });
});
