import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { readFileSync } from 'node:fs';
import {
  EXPECTED_RELEASE_COMMAND,
  findAlwaysOnProblem,
  findDockerfileBunVersionProblem,
  findFlyDatabaseSecretProblem,
  findFlyReleaseCommandProblem,
  findMigrationCredentialProblem,
  findMigratorAppProblem,
  findRuntimeRoleGateProblem,
  findWebReleaseCommandProblem,
  findWorkflowMigrationOrderProblem,
  verifyDeployConfig,
} from './verify-deploy-config';

setupRitewayBun();

const realDockerfile = readFileSync('apps/web/Dockerfile', 'utf8');
const realFlyToml = readFileSync('fly.toml', 'utf8');
const realMigratorToml = readFileSync('fly.migrate.toml', 'utf8');
const realWorkflow = readFileSync(
  '.github/workflows/deploy-staging.yml',
  'utf8',
);
const realBunVersion = readFileSync('.bun-version', 'utf8').trim();
const realStart = readFileSync('apps/web/src/server/start.ts', 'utf8');
const realMigrate = readFileSync('packages/db/scripts/migrate.ts', 'utf8');

describe('findDockerfileBunVersionProblem', () => {
  test('the committed Dockerfile pins the committed .bun-version', () => {
    assert({
      given: 'the real Dockerfile and .bun-version',
      should: 'report no drift',
      actual: findDockerfileBunVersionProblem({
        dockerfile: realDockerfile,
        bunVersion: realBunVersion,
      }),
      expected: null,
    });
  });

  test('a Dockerfile pinned to a different Bun version', () => {
    assert({
      given: 'FROM oven/bun:1.0.0-slim AS base with .bun-version 1.4.2',
      should: 'report the drift',
      actual: findDockerfileBunVersionProblem({
        dockerfile: 'FROM oven/bun:1.0.0-slim AS base\n',
        bunVersion: '1.4.2',
      }),
      expected:
        'Dockerfile pins oven/bun:1.0.0-slim, but .bun-version is 1.4.2',
    });
  });

  test('a Dockerfile missing the base image line entirely', () => {
    assert({
      given: 'a Dockerfile with no base stage',
      should: 'report it missing rather than pass silently',
      actual: findDockerfileBunVersionProblem({
        dockerfile: 'FROM node:22 AS base\n',
        bunVersion: '1.4.2',
      }),
      expected: 'Dockerfile has no `FROM oven/bun:<version> AS base` line',
    });
  });
});

describe('findFlyReleaseCommandProblem', () => {
  test('the committed fly.migrate.toml keeps the migration release command', () => {
    assert({
      given: 'the real fly.migrate.toml',
      should: 'report no drift',
      actual: findFlyReleaseCommandProblem(realMigratorToml),
      expected: null,
    });
  });

  test('fly.toml with the release_command line removed', () => {
    assert({
      given: 'a [deploy] block with no release_command',
      should: 'report it missing',
      actual: findFlyReleaseCommandProblem('[deploy]\n'),
      expected: 'fly.migrate.toml has no `release_command` under [deploy]',
    });
  });

  test('fly.toml with an emptied release_command', () => {
    assert({
      given: 'release_command = ""',
      should: 'report it empty',
      actual: findFlyReleaseCommandProblem(
        '[deploy]\n  release_command = ""\n',
      ),
      expected: 'fly.migrate.toml release_command is empty',
    });
  });

  test('fly.toml with a wrong non-empty release_command', () => {
    assert({
      given: 'release_command = "true", which skips the migration entirely',
      should: 'report the mismatch, not pass silently',
      actual: findFlyReleaseCommandProblem(
        '[deploy]\n  release_command = "true"\n',
      ),
      expected: `fly.migrate.toml release_command is "true", expected "${EXPECTED_RELEASE_COMMAND}"`,
    });
  });

  test('fly.toml with the release_command commented out', () => {
    assert({
      given: `[deploy] with only a commented-out release_command`,
      should: 'report it missing rather than read the comment as the value',
      actual: findFlyReleaseCommandProblem(
        `[deploy]\n  # release_command = "${EXPECTED_RELEASE_COMMAND}"\n`,
      ),
      expected: 'fly.migrate.toml has no `release_command` under [deploy]',
    });
  });

  test('release_command present, but under a different table than [deploy]', () => {
    assert({
      given: `a correct-looking release_command under [other] instead of [deploy]`,
      should: 'report it missing under [deploy], ignoring the other table',
      actual: findFlyReleaseCommandProblem(
        `[deploy]\n[other]\n  release_command = "${EXPECTED_RELEASE_COMMAND}"\n`,
      ),
      expected: 'fly.migrate.toml has no `release_command` under [deploy]',
    });
  });

  test('fly.toml missing the [deploy] table entirely', () => {
    assert({
      given: 'a fly.toml with no [deploy] table at all',
      should: 'report the table missing',
      actual: findFlyReleaseCommandProblem('[env]\n  PORT = "8080"\n'),
      expected: 'fly.migrate.toml has no `[deploy]` table',
    });
  });
});

describe('verifyDeployConfig', () => {
  test('the real repository files together', () => {
    assert({
      given:
        'the committed Dockerfile, both fly configs, the deploy workflow, .bun-version, start.ts and migrate.ts',
      should: 'report no problems',
      actual: verifyDeployConfig({
        dockerfile: realDockerfile,
        flyToml: realFlyToml,
        migratorToml: realMigratorToml,
        workflow: realWorkflow,
        bunVersion: realBunVersion,
        startTs: realStart,
        migrateTs: realMigrate,
      }),
      expected: [],
    });
  });

  test('both files drifted at once', () => {
    assert({
      given: 'a wrong Bun version and a dropped release command',
      should: 'report both problems, not just the first',
      actual: verifyDeployConfig({
        dockerfile: 'FROM oven/bun:1.0.0-slim AS base\n',
        flyToml: realFlyToml,
        migratorToml: '[deploy]\n',
        workflow: realWorkflow,
        bunVersion: '1.4.2',
        startTs: realStart,
        migrateTs: realMigrate,
      }).length,
      expected: 2,
    });
  });
});

describe('findFlyDatabaseSecretProblem', () => {
  test('the committed fly configs keep database credentials out of [env]', () => {
    assert({
      given: 'the real fly.migrate.toml',
      should: 'report no problem',
      actual: findFlyDatabaseSecretProblem(
        realMigratorToml,
        'fly.migrate.toml',
      ),
      expected: null,
    });
    assert({
      given: 'the real fly.toml',
      should: 'report no problem: both URLs are Fly secrets',
      actual: findFlyDatabaseSecretProblem(realFlyToml),
      expected: null,
    });
  });

  test('a database URL written into [env]', () => {
    assert({
      given:
        'fly.toml [env] setting MIGRATION_DATABASE_URL, with a commented DATABASE_URL beside it',
      should: 'report the uncommented credential only',
      actual: findFlyDatabaseSecretProblem(
        '[env]\n  # DATABASE_URL = "x"\n  MIGRATION_DATABASE_URL = "postgres://x"\n[http_service]\n',
      ),
      expected:
        'fly.toml [env] sets MIGRATION_DATABASE_URL; database credentials are Fly secrets',
    });
  });
});

describe('findRuntimeRoleGateProblem (ISSUE-39, ISSUE-193)', () => {
  const refusal =
    "  refuseRole: () => refuseSchemaAlteringRole(app, 'daisy_web'),\n";
  const start = (body: string, awaitStarted = 'await started;\n') =>
    `const { server, started } = startProductionServer({\n  app,\n  nextApp,\n${body}  port,\n  host: '0.0.0.0',\n});\n${awaitStarted}`;
  const missing =
    "start.ts does not start through startProductionServer with refuseRole: () => refuseSchemaAlteringRole(app, 'daisy_web') and await started";

  test('the committed start.ts starts only through startProductionServer', () => {
    assert({
      given: 'the real start.ts',
      should: 'report no problem',
      actual: findRuntimeRoleGateProblem(realStart),
      expected: null,
    });
  });

  test('a start.ts without the role refusal, with it commented out, or not awaiting start-up', () => {
    assert({
      given:
        'no refuseRole, a commented refuseRole, and a start-up whose result is never awaited',
      should: 'report each as missing its gated start-up',
      actual: [
        start(''),
        start(`  // ${refusal.trim()}\n`),
        start(refusal, ''),
      ].map(findRuntimeRoleGateProblem),
      expected: [missing, missing, missing],
    });
  });

  test('a start.ts that composes, prepares or listens outside startProductionServer', () => {
    assert({
      given:
        "the review's mutation (Next's handler handed to createProductionServer), a direct nextApp.prepare(), and a direct server.listen",
      should: 'report each as bypassing the start-up gate',
      actual: [
        `${start(refusal)}const bypass = createProductionServer({ app, handle: nextApp.getRequestHandler(), readRouteTable });\n`,
        `await nextApp.prepare();\n${start(refusal)}`,
        `${start(refusal)}server.listen(port, '0.0.0.0');\n`,
      ].map(findRuntimeRoleGateProblem),
      expected: [
        'start.ts bypasses the start-up gate with createProductionServer(; start only through startProductionServer (ISSUE-193)',
        'start.ts bypasses the start-up gate with nextApp.prepare(; start only through startProductionServer (ISSUE-193)',
        'start.ts bypasses the start-up gate with .listen(; start only through startProductionServer (ISSUE-193)',
      ],
    });
  });
});

describe('findRuntimeRoleGateProblem refuses a disabled refusal (ISSUE-206)', () => {
  const refusalLine =
    "  refuseRole: () => refuseSchemaAlteringRole(app, 'daisy_web'),\n";
  const importLine = "import { refuseSchemaAlteringRole } from '@daisy/db';\n";
  const withRefusal = (after: string) =>
    realStart.replace(refusalLine, `${refusalLine}${after}`);
  const oneCall =
    'start.ts must call startProductionServer exactly once; a second call starts a server the checked refusal does not guard (ISSUE-206)';
  const overridden =
    "start.ts's startProductionServer call sets refuseRole more than once or spreads other options into it; only refuseRole: () => refuseSchemaAlteringRole(app, 'daisy_web') may set it (ISSUE-206)";
  const notFromDb =
    'start.ts must import refuseSchemaAlteringRole from @daisy/db and use it only as the refuseRole (ISSUE-206)';

  test('the committed start.ts still reports no problem', () => {
    assert({
      given: 'the real start.ts',
      should: 'report no problem',
      actual: findRuntimeRoleGateProblem(realStart),
      expected: null,
    });
  });

  test("the review's shape: a second startProductionServer call with a no-op refuseRole", () => {
    assert({
      given:
        'the committed call kept and a second startProductionServer({ ..., refuseRole: async () => {} }) added',
      should: 'report the second call',
      actual: findRuntimeRoleGateProblem(
        `${realStart}const bypass = startProductionServer({\n  app,\n  nextApp,\n  refuseRole: async () => {},\n  readRouteTable: () => null,\n  port: port + 1,\n  host: '0.0.0.0',\n});\nawait bypass.started;\n`,
      ),
      expected: oneCall,
    });
  });

  test("the review's shape: a later spread or refuseRole key that overrides the refusal", () => {
    assert({
      given:
        'a spread of a no-op refuseRole, a spread of an options object, and a second refuseRole key, each after the committed refusal',
      should: 'report each as overriding the refusal',
      actual: [
        withRefusal('  ...{ refuseRole: async () => {} },\n'),
        withRefusal('  ...overrides,\n'),
        withRefusal('  refuseRole: async () => {},\n'),
      ].map(findRuntimeRoleGateProblem),
      expected: [overridden, overridden, overridden],
    });
  });

  test('a no-op refuseSchemaAlteringRole that shadows or replaces the @daisy/db one', () => {
    assert({
      given:
        'the import swapped for a local no-op, the import pointed at another module, and a local no-op declared beside the import',
      should: 'report each as not refusing through @daisy/db',
      actual: [
        realStart.replace(
          importLine,
          'const refuseSchemaAlteringRole = async (..._: unknown[]) => {};\n',
        ),
        realStart.replace(
          importLine,
          "import { refuseSchemaAlteringRole } from './no-op';\n",
        ),
        realStart
          .replace(
            'const { server, started } = startProductionServer({',
            'const noOp = async () => {};\nconst { server, started } = startProductionServer({',
          )
          .replace(
            refusalLine,
            "  refuseRole: () => noOp() ?? refuseSchemaAlteringRole(app, 'daisy_web'),\n",
          ),
      ].map(findRuntimeRoleGateProblem),
      expected: [
        notFromDb,
        notFromDb,
        "start.ts does not start through startProductionServer with refuseRole: () => refuseSchemaAlteringRole(app, 'daisy_web') and await started",
      ],
    });
  });
});

describe('findMigrationCredentialProblem', () => {
  test('the committed runner reads the validated migration credential', () => {
    assert({
      given: 'the real migrate.ts',
      should: 'report no problem',
      actual: findMigrationCredentialProblem(realMigrate),
      expected: null,
    });
  });

  test('a runner that reads the runtime DATABASE_URL directly', () => {
    assert({
      given: 'the pre-ISSUE-39 runner reading process.env.DATABASE_URL',
      should: 'report that it bypasses the migration credential',
      actual: findMigrationCredentialProblem(
        'const url = process.env.DATABASE_URL;\nnew SQL(url);\n',
      ),
      expected:
        'migrate.ts does not read its credential through readMigrationConfig(process.env)',
    });
  });
});

describe('findWebReleaseCommandProblem (ISSUE-102)', () => {
  test('the committed web fly.toml runs no release command', () => {
    assert({
      given: 'the real fly.toml',
      should: 'report no problem',
      actual: findWebReleaseCommandProblem(realFlyToml),
      expected: null,
    });
  });

  test('a web fly.toml that migrates in its own release', () => {
    assert({
      given: `the pre-ISSUE-102 web [deploy] release_command`,
      should:
        'report it, because it would need the owner credential among the web secrets',
      actual: findWebReleaseCommandProblem(
        `[deploy]\n  # the old way\n  release_command = "${EXPECTED_RELEASE_COMMAND}"\n`,
      ),
      expected:
        'fly.toml runs a release_command; migrations run only from fly.migrate.toml, so the web app never holds the owner credential',
    });
  });
});

describe('findMigratorAppProblem (ISSUE-102)', () => {
  test('the committed migrator app serves nothing', () => {
    assert({
      given: 'the real fly.migrate.toml',
      should: 'report no problem',
      actual: findMigratorAppProblem(realMigratorToml),
      expected: null,
    });
  });

  test('a migrator app that would boot serving machines', () => {
    assert({
      given:
        'fly.migrate.toml with an [http_service], [[services]] or [processes]',
      should: 'report each, since its machines would hold the owner credential',
      actual: [
        '[http_service]\n  internal_port = 8080\n',
        '[[services]]\n',
        '[processes]\n  app = "bun start"\n',
        '# [http_service]\n',
      ].map(findMigratorAppProblem),
      expected: [
        'fly.migrate.toml defines [http_service]; the migrator app must have no services or processes',
        'fly.migrate.toml defines [[services]]; the migrator app must have no services or processes',
        'fly.migrate.toml defines [processes]; the migrator app must have no services or processes',
        null,
      ],
    });
  });
});

describe('findWorkflowMigrationOrderProblem (ISSUE-102)', () => {
  const migrate =
    '        run: >-\n          flyctl deploy -c fly.migrate.toml --remote-only --update-only\n';
  const web =
    '        run: >-\n          flyctl deploy -a daisy-debate-staging --remote-only --ha=false\n';

  test('the committed workflow migrates before the web deploy', () => {
    assert({
      given: 'the real deploy-staging workflow',
      should: 'report no problem',
      actual: findWorkflowMigrationOrderProblem(realWorkflow),
      expected: null,
    });
  });

  test('a workflow that skips the migrator, deploys web first, or lets it create machines', () => {
    const problem =
      'deploy-staging.yml does not run `flyctl deploy -c fly.migrate.toml ... --update-only` before the web deploy';
    assert({
      given:
        'no migrator deploy, a migrator deploy after the web one, a commented migrator deploy, and one without --update-only',
      should: 'report each',
      actual: [
        web,
        web + migrate,
        '# flyctl deploy -c fly.migrate.toml --remote-only --update-only\n' +
          web,
        migrate.replace(' --update-only', '') + web,
      ].map(findWorkflowMigrationOrderProblem),
      expected: [problem, problem, problem, problem],
    });
  });
});

describe('findAlwaysOnProblem (ISSUE-175, DEC-40)', () => {
  const service = (lines: string) =>
    `[http_service]\n  internal_port = 8080\n${lines}\n\n  [[http_service.checks]]\n    grace_period = "10s"\n`;

  test('the committed fly.toml keeps staging always on', () => {
    assert({
      given: 'the real fly.toml',
      should: 'report no problem',
      actual: findAlwaysOnProblem(realFlyToml),
      expected: null,
    });
  });

  test('a service that may stop idle machines or keep none running', () => {
    assert({
      given:
        'auto-stop on, no machine kept running, a commented-out setting, and no [http_service]',
      should: 'report each as not always on',
      actual: [
        service('  auto_stop_machines = "stop"\n  min_machines_running = 1'),
        service('  auto_stop_machines = "off"\n  min_machines_running = 0'),
        service('  # auto_stop_machines = "off"\n  min_machines_running = 1'),
        '[env]\n  PORT = "8080"\n',
      ].map(findAlwaysOnProblem),
      expected: [
        'fly.toml [http_service] must set auto_stop_machines = "off" (DEC-40)',
        'fly.toml [http_service] must set min_machines_running = 1 (DEC-40)',
        'fly.toml [http_service] must set auto_stop_machines = "off" (DEC-40)',
        'fly.toml has no `[http_service]` table',
      ],
    });
  });
});
