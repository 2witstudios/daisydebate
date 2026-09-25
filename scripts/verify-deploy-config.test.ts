import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { readFileSync } from 'node:fs';
import {
  EXPECTED_RELEASE_COMMAND,
  findDockerfileBunVersionProblem,
  findFlyDatabaseSecretProblem,
  findFlyReleaseCommandProblem,
  findMigrationCredentialProblem,
  findRuntimeRoleGateProblem,
  verifyDeployConfig,
} from './verify-deploy-config';

setupRitewayBun();

const realDockerfile = readFileSync('apps/web/Dockerfile', 'utf8');
const realFlyToml = readFileSync('fly.toml', 'utf8');
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
  test('the committed fly.toml keeps the migration release command', () => {
    assert({
      given: 'the real fly.toml',
      should: 'report no drift',
      actual: findFlyReleaseCommandProblem(realFlyToml),
      expected: null,
    });
  });

  test('fly.toml with the release_command line removed', () => {
    assert({
      given: 'a [deploy] block with no release_command',
      should: 'report it missing',
      actual: findFlyReleaseCommandProblem('[deploy]\n'),
      expected: 'fly.toml has no `release_command` under [deploy]',
    });
  });

  test('fly.toml with an emptied release_command', () => {
    assert({
      given: 'release_command = ""',
      should: 'report it empty',
      actual: findFlyReleaseCommandProblem(
        '[deploy]\n  release_command = ""\n',
      ),
      expected: 'fly.toml release_command is empty',
    });
  });

  test('fly.toml with a wrong non-empty release_command', () => {
    assert({
      given: 'release_command = "true", which skips the migration entirely',
      should: 'report the mismatch, not pass silently',
      actual: findFlyReleaseCommandProblem(
        '[deploy]\n  release_command = "true"\n',
      ),
      expected: `fly.toml release_command is "true", expected "${EXPECTED_RELEASE_COMMAND}"`,
    });
  });

  test('fly.toml with the release_command commented out', () => {
    assert({
      given: `[deploy] with only a commented-out release_command`,
      should: 'report it missing rather than read the comment as the value',
      actual: findFlyReleaseCommandProblem(
        `[deploy]\n  # release_command = "${EXPECTED_RELEASE_COMMAND}"\n`,
      ),
      expected: 'fly.toml has no `release_command` under [deploy]',
    });
  });

  test('release_command present, but under a different table than [deploy]', () => {
    assert({
      given: `a correct-looking release_command under [other] instead of [deploy]`,
      should: 'report it missing under [deploy], ignoring the other table',
      actual: findFlyReleaseCommandProblem(
        `[deploy]\n[other]\n  release_command = "${EXPECTED_RELEASE_COMMAND}"\n`,
      ),
      expected: 'fly.toml has no `release_command` under [deploy]',
    });
  });

  test('fly.toml missing the [deploy] table entirely', () => {
    assert({
      given: 'a fly.toml with no [deploy] table at all',
      should: 'report the table missing',
      actual: findFlyReleaseCommandProblem('[env]\n  PORT = "8080"\n'),
      expected: 'fly.toml has no `[deploy]` table',
    });
  });
});

describe('verifyDeployConfig', () => {
  test('the real repository files together', () => {
    assert({
      given:
        'the committed Dockerfile, fly.toml, .bun-version, start.ts and migrate.ts',
      should: 'report no problems',
      actual: verifyDeployConfig({
        dockerfile: realDockerfile,
        flyToml: realFlyToml,
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
        flyToml: '[deploy]\n',
        bunVersion: '1.4.2',
        startTs: realStart,
        migrateTs: realMigrate,
      }).length,
      expected: 2,
    });
  });
});

describe('findFlyDatabaseSecretProblem', () => {
  test('the committed fly.toml keeps database credentials out of [env]', () => {
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

describe('findRuntimeRoleGateProblem', () => {
  const prepare = 'await nextApp.prepare();\n';
  const gate = "await refuseSchemaAlteringRole(app, 'daisy_web');\n";

  test('the committed start.ts gates the role before serving', () => {
    assert({
      given: 'the real start.ts',
      should: 'report no problem',
      actual: findRuntimeRoleGateProblem(realStart),
      expected: null,
    });
  });

  test('a start.ts without the gate, or with it after Next prepares', () => {
    assert({
      given: 'no gate, a commented gate, and a gate after nextApp.prepare()',
      should: 'report each as missing its startup role check',
      actual: [prepare, `// ${gate}${prepare}`, `${prepare}${gate}`].map(
        findRuntimeRoleGateProblem,
      ),
      expected: Array(3).fill(
        "start.ts does not await refuseSchemaAlteringRole(app, 'daisy_web') before nextApp.prepare()",
      ),
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
