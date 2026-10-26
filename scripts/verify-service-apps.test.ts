import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { readFileSync } from 'node:fs';
import {
  findServiceAppConfigProblems,
  findServiceAppProblems,
  findServiceDeployProblems,
  findServiceEnvProblems,
  findSharedNamespaceProblem,
  SERVICE_APPS,
} from './verify-service-apps';

setupRitewayBun();

const realWorkflow = readFileSync(
  '.github/workflows/deploy-staging.yml',
  'utf8',
);
const readRepoFile = (path: string) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
};

describe('findServiceAppProblems (ISSUE-528)', () => {
  const toml = (lines: string) =>
    `app = "daisy-debate-staging-realtime"\nkill_timeout = 35\n\n[build]\n  dockerfile = "apps/web/Dockerfile"\n  build-target = "realtime"\n\n[env]\n  LOG_LEVEL = "info"\n${lines}`;
  const realtime = {
    file: 'fly.realtime.toml',
    target: 'realtime',
    stopMs: 25_000,
  };

  test('the committed service apps', () => {
    assert({
      given: 'each committed service config and the stop budget in its source',
      should: 'report no problem',
      actual: findServiceAppConfigProblems(readRepoFile),
      expected: [],
    });
  });

  test('a stop budget the verifier cannot read', () => {
    assert({
      given: 'service sources without their stop budget',
      should: 'report each source rather than pass unchecked',
      actual: findServiceAppConfigProblems((path) =>
        path.endsWith('.ts') ? '' : readRepoFile(path),
      ),
      expected: SERVICE_APPS.flatMap((app) =>
        app.stop
          ? [
              `${app.stop.source} no longer states its stop budget as ${app.stop.pattern}`,
            ]
          : [],
      ),
    });
  });

  test('a service config that drifted', () => {
    assert({
      given:
        'the unread `target` key in place of build-target, a release command and a kill_timeout under the stop budget',
      should: 'report each',
      actual: findServiceAppProblems({
        ...realtime,
        toml: toml(
          '  MEDIA_WORKER_DATABASE_URL = "postgres://x"\n\n[deploy]\n  release_command = "bun migrate.ts"\n',
        )
          .replace('build-target = "realtime"', 'target = "realtime"')
          .replace('kill_timeout = 35', 'kill_timeout = 20'),
      }),
      expected: [
        'fly.realtime.toml must build `build-target = "realtime"` from apps/web/Dockerfile',
        'fly.realtime.toml runs a release_command; migrations run only from fly.migrate.toml',
        'fly.realtime.toml kill_timeout must be at least 35 s (the 25 s stop budget plus 10 s margin)',
      ],
    });
  });

  test('the default kill_timeout', () => {
    assert({
      given: 'a service config with no kill_timeout',
      should: "report Fly's 5 s default as too short",
      actual: findServiceAppProblems({
        ...realtime,
        toml: toml('').replace('kill_timeout = 35\n', ''),
      }),
      expected: [
        'fly.realtime.toml kill_timeout must be at least 35 s (the 25 s stop budget plus 10 s margin)',
      ],
    });
  });
});

describe('findServiceDeployProblems (ISSUE-528)', () => {
  const step = (config: string, token: string) =>
    `      - id: x\n        env:\n          FLY_API_TOKEN: \${{ secrets.${token} }}\n        run: >-\n          flyctl deploy -c ${config} --local-only\n`;
  const migrate =
    '      - id: migrate\n        run: >-\n          flyctl deploy -c fly.migrate.toml --local-only --update-only\n';
  const all = SERVICE_APPS.map((app) => step(app.file, app.token)).join('');

  test('the committed workflow deploys every service app', () => {
    assert({
      given: 'the real deploy-staging workflow',
      should: 'report no problem',
      actual: findServiceDeployProblems(realWorkflow),
      expected: [],
    });
  });

  test('a workflow missing a deploy, deploying before the migration, or with a shared token', () => {
    const [first] = SERVICE_APPS;
    assert({
      given:
        'no service deploys, one before the migrator, and one using another app token',
      should: 'report each',
      actual: [
        findServiceDeployProblems(migrate).length,
        findServiceDeployProblems(all + migrate).length,
        findServiceDeployProblems(
          migrate +
            all.replace(`secrets.${first?.token}`, 'secrets.FLY_API_TOKEN'),
        ),
      ],
      expected: [
        SERVICE_APPS.length,
        SERVICE_APPS.length,
        [
          `deploy-staging.yml must deploy ${first?.file} after the migration, with its own secrets.${first?.token}`,
        ],
      ],
    });
  });
});

describe('findServiceEnvProblems (ISSUE-528)', () => {
  const served = (env: string, service: string) =>
    `app = "x"\n\n[env]\n${env}\n\n[http_service]\n  internal_port = 8080\n${service}\n`;
  const alwaysOn = '  auto_stop_machines = "off"\n  min_machines_running = 1';

  test('every committed service app keeps credentials out and stays on', () => {
    assert({
      given: 'each committed service config',
      should: 'report no problem',
      actual: SERVICE_APPS.flatMap((app) =>
        findServiceEnvProblems({
          file: app.file,
          toml: readRepoFile(app.file) ?? '',
        }),
      ),
      expected: [],
    });
  });

  test('a credential in [env], or a served app that may stop', () => {
    assert({
      given:
        'LIVEKIT_KEYS, a REDIS_URL and a database URL in [env], then a service that auto-stops and keeps none running',
      should: 'report each credential and each always-on setting',
      actual: [
        findServiceEnvProblems({
          file: 'fly.x.toml',
          toml: served(
            '  LIVEKIT_KEYS = "k: s"\n  REDIS_URL = "redis://x"\n  MEDIA_WORKER_DATABASE_URL = "postgres://x"',
            alwaysOn,
          ),
        }),
        findServiceEnvProblems({
          file: 'fly.x.toml',
          toml: served(
            '  LOG_LEVEL = "info"',
            '  auto_stop_machines = "stop"\n  min_machines_running = 0',
          ),
        }),
      ],
      expected: [
        [
          'fly.x.toml [env] sets LIVEKIT_KEYS; credentials are Fly secrets',
          'fly.x.toml [env] sets REDIS_URL; credentials are Fly secrets',
          'fly.x.toml [env] sets MEDIA_WORKER_DATABASE_URL; credentials are Fly secrets',
        ],
        [
          'fly.x.toml [http_service] must set auto_stop_machines = "off" and min_machines_running = 1 (DEC-40)',
        ],
      ],
    });
  });
});

describe('findSharedNamespaceProblem (ISSUE-528)', () => {
  test('web and realtime read one ticket namespace', () => {
    const web = readRepoFile('fly.toml') ?? '';
    const realtime = readRepoFile('fly.realtime.toml') ?? '';
    assert({
      given:
        'the committed configs, then a realtime config on another namespace',
      should:
        'pass the committed pair and report the mismatch, since tickets are namespaced',
      actual: [
        findSharedNamespaceProblem(web, realtime),
        findSharedNamespaceProblem(
          web,
          realtime.replace(
            'REDIS_NAMESPACE = "daisy"',
            'REDIS_NAMESPACE = "other"',
          ),
        ),
      ],
      expected: [
        null,
        'fly.toml and fly.realtime.toml must set the same REDIS_NAMESPACE in [env] (never as a Fly secret): realtime redeems the tickets the web app issues under it',
      ],
    });
  });
});

describe('findServiceDeployProblems job-level token (ISSUE-528)', () => {
  test('a token set for the whole deploy job', () => {
    assert({
      given:
        'the real workflow with FLY_API_TOKEN moved into the deploy job env',
      should: 'report it, since every step would then hold it',
      actual: findServiceDeployProblems(
        realWorkflow.replace(
          '    env:\n      # The commit CI verified',
          '    env:\n      FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}\n      # The commit CI verified',
        ),
      ).includes(
        'deploy-staging.yml sets FLY_API_TOKEN for a whole job; each deploy token belongs to its own step',
      ),
      expected: true,
    });
  });
});
