import { readFileSync } from 'node:fs';

/** Pure check: does the Dockerfile's base image pin exactly `.bun-version`? */
export function findDockerfileBunVersionProblem(input: {
  readonly dockerfile: string;
  readonly bunVersion: string;
}): string | null {
  const pinned = input.dockerfile.match(/FROM oven\/bun:(\S+) AS base/);
  if (!pinned)
    return 'Dockerfile has no `FROM oven/bun:<version> AS base` line';
  const tag = pinned[1];
  if (tag !== `${input.bunVersion}-slim` && tag !== input.bunVersion)
    return `Dockerfile pins oven/bun:${tag}, but .bun-version is ${input.bunVersion}`;
  return null;
}

// The migration runner path baked into the runtime image by
// apps/web/Dockerfile (packages/db/scripts/migrate.ts, copied alongside
// packages/db/migrations). Changing where the Dockerfile puts the runner
// requires updating this constant too — that coupling is the point: it is
// the one place release_command drift (a no-op command, or a command that
// can't run from the image) gets caught before a release ships unmigrated.
export const EXPECTED_RELEASE_COMMAND =
  'bun /app/packages/db/scripts/migrate.ts';

const uncommented = (text: string) =>
  text
    .split('\n')
    .filter((line) => !/^\s*(#|\/\/)/.test(line))
    .join('\n');

/** The body of `[table]`, up to the next table header. */
const tableBody = (toml: string, table: string): string[] | null => {
  const lines = toml.split('\n');
  const start = lines.findIndex((line) => line.trim() === table);
  if (start === -1) return null;
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\[/.test(line.trim())) break;
    body.push(line);
  }
  return body;
};

/**
 * Pure check: does fly.migrate.toml's `[deploy]` table keep exactly the
 * required migration release command? Scoped to the `[deploy]` table body
 * so a same-named key under another table, or a commented-out line, cannot
 * satisfy it.
 */
export function findFlyReleaseCommandProblem(
  migratorToml: string,
): string | null {
  const body = tableBody(migratorToml, '[deploy]');
  if (body === null) return 'fly.migrate.toml has no `[deploy]` table';
  const match = uncommented(body.join('\n')).match(
    /release_command\s*=\s*"([^"]*)"/,
  );
  if (!match) return 'fly.migrate.toml has no `release_command` under [deploy]';
  const value = match[1].trim();
  if (value === '') return 'fly.migrate.toml release_command is empty';
  if (value !== EXPECTED_RELEASE_COMMAND)
    return `fly.migrate.toml release_command is "${value}", expected "${EXPECTED_RELEASE_COMMAND}"`;
  return null;
}

/**
 * ISSUE-102: Fly secrets are app-wide, and a release command inherits them,
 * so the web app migrating in its own release would need the owner
 * credential on every web machine. Only the migrator app releases.
 */
export function findWebReleaseCommandProblem(flyToml: string): string | null {
  return /^\s*release_command\s*=/m.test(uncommented(flyToml))
    ? 'fly.toml runs a release_command; migrations run only from fly.migrate.toml, so the web app never holds the owner credential'
    : null;
}

/**
 * ISSUE-102: the migrator app holds the owner credential, so it must never
 * boot a machine of its own: no services and no process groups, leaving
 * the release command's temporary machine as the only one.
 */
export function findMigratorAppProblem(migratorToml: string): string | null {
  const table = uncommented(migratorToml)
    .split('\n')
    .map((line) => line.trim())
    .find((line) =>
      ['[http_service]', '[[services]]', '[processes]'].includes(line),
    );
  return table
    ? `fly.migrate.toml defines ${table}; the migrator app must have no services or processes`
    : null;
}

/**
 * ISSUE-102: the workflow deploys the migrator app, creating no machines,
 * before the web app, so a failed migration stops the web release as Fly's
 * own release_command did.
 */
export function findWorkflowMigrationOrderProblem(
  workflow: string,
): string | null {
  const code = uncommented(workflow);
  const migrate = code.search(
    /flyctl deploy -c fly\.migrate\.toml[^\n]*--update-only/,
  );
  const web = code.indexOf('flyctl deploy -a daisy-debate-staging ');
  return migrate === -1 || web === -1 || migrate > web
    ? 'deploy-staging.yml does not run `flyctl deploy -c fly.migrate.toml ... --update-only` before the web deploy'
    : null;
}

/**
 * ISSUE-39: DATABASE_URL (`daisy_web`) and MIGRATION_DATABASE_URL (the
 * owner) are Fly secrets, in different apps (ADR 0041). Fly configs are
 * committed, so their [env] tables must never carry either.
 */
export function findFlyDatabaseSecretProblem(
  toml: string,
  file: 'fly.toml' | 'fly.migrate.toml' = 'fly.toml',
): string | null {
  const body = tableBody(toml, '[env]');
  if (body === null) return null;
  const key = uncommented(body.join('\n')).match(
    /^\s*((?:MIGRATION_)?DATABASE_URL)\s*=/m,
  );
  return key
    ? `${file} [env] sets ${key[1]}; database credentials are Fly secrets`
    : null;
}

/**
 * ISSUE-39, ISSUE-193: production startup refuses a DATABASE_URL role that
 * can create or alter schema objects before Next prepares, and no request
 * reaches Next before both finish. That ordering lives in
 * startProductionServer (apps/web/src/server/listen-first.ts, tested there);
 * start.ts must start only through it, handing it the refusal, and must not
 * compose, prepare or listen on its own.
 */
export function findRuntimeRoleGateProblem(startTs: string): string | null {
  const code = uncommented(startTs);
  for (const bypass of [
    'createProductionServer(',
    'getRequestHandler(',
    'nextApp.prepare(',
    '.listen(',
  ])
    if (code.includes(bypass))
      return `start.ts bypasses the start-up gate with ${bypass}; start only through startProductionServer (ISSUE-193)`;
  return code.includes('startProductionServer({') &&
    code.includes(
      "refuseRole: () => refuseSchemaAlteringRole(app, 'daisy_web'),",
    ) &&
    code.includes('await started;')
    ? null
    : "start.ts does not start through startProductionServer with refuseRole: () => refuseSchemaAlteringRole(app, 'daisy_web') and await started";
}

/**
 * ISSUE-39: the release command migrates through the validated migration
 * credential, never by reading the runtime DATABASE_URL itself.
 */
export function findMigrationCredentialProblem(
  migrateTs: string,
): string | null {
  const code = uncommented(migrateTs);
  return code.includes('readMigrationConfig(process.env)') &&
    !code.includes('process.env.DATABASE_URL')
    ? null
    : 'migrate.ts does not read its credential through readMigrationConfig(process.env)';
}

/**
 * Owner decision DEC-40 (ISSUE-175): the staging web app is always on.
 * fly-proxy never stops its machine for idleness and keeps one running.
 */
export function findAlwaysOnProblem(flyToml: string): string | null {
  const body = tableBody(flyToml, '[http_service]');
  if (body === null) return 'fly.toml has no `[http_service]` table';
  const service = uncommented(body.join('\n'));
  if (!/^\s*auto_stop_machines\s*=\s*"off"\s*$/m.test(service))
    return 'fly.toml [http_service] must set auto_stop_machines = "off" (DEC-40)';
  if (!/^\s*min_machines_running\s*=\s*1\s*$/m.test(service))
    return 'fly.toml [http_service] must set min_machines_running = 1 (DEC-40)';
  return null;
}

/** Seconds Fly must wait past the drain deadline before it SIGKILLs. */
const KILL_TIMEOUT_MARGIN_S = 10;

/**
 * ISSUE-214: Fly sends kill_signal and SIGKILLs a machine that has not
 * exited kill_timeout later (default 5 s). The server drains for up to
 * SHUTDOWN_DRAIN_DEADLINE_MS (apps/web/src/server/shutdown-budget.ts) and
 * then forces its own exit, so kill_timeout, a top-level key in seconds or
 * a duration string, must exceed that deadline with margin, and start.ts
 * must drain with that constant.
 */
export function findKillTimeoutProblem(input: {
  readonly flyToml: string;
  readonly shutdownBudgetTs: string;
  readonly startTs: string;
}): string | null {
  const deadline = uncommented(input.shutdownBudgetTs).match(
    /export const SHUTDOWN_DRAIN_DEADLINE_MS = ([\d_]+);/,
  );
  if (!deadline)
    return 'shutdown-budget.ts does not export SHUTDOWN_DRAIN_DEADLINE_MS as a number of milliseconds';
  if (
    !uncommented(input.startTs).includes(
      'deadlineMs: SHUTDOWN_DRAIN_DEADLINE_MS,',
    )
  )
    return 'start.ts does not drain with deadlineMs: SHUTDOWN_DRAIN_DEADLINE_MS';
  const drainSeconds = Math.ceil(
    Number(deadline[1]?.replaceAll('_', '')) / 1000,
  );
  const required = drainSeconds + KILL_TIMEOUT_MARGIN_S;
  const topLevel = uncommented(input.flyToml).split(/^\s*\[/m)[0] ?? '';
  const setting = topLevel.match(
    /^\s*kill_timeout\s*=\s*(?:(\d+)|"(\d+)s")\s*$/m,
  );
  const seconds = Number(setting?.[1] ?? setting?.[2] ?? 5);
  return seconds >= required
    ? null
    : `fly.toml kill_timeout must be at least ${required} s (the ${drainSeconds} s shutdown drain plus ${KILL_TIMEOUT_MARGIN_S} s margin); Fly SIGKILLs a machine that has not exited by then (ISSUE-214)`;
}

export function verifyDeployConfig(input: {
  readonly dockerfile: string;
  readonly flyToml: string;
  readonly migratorToml: string;
  readonly workflow: string;
  readonly bunVersion: string;
  readonly startTs: string;
  readonly migrateTs: string;
  readonly shutdownBudgetTs: string;
}): readonly string[] {
  return [
    findDockerfileBunVersionProblem({
      dockerfile: input.dockerfile,
      bunVersion: input.bunVersion,
    }),
    findFlyReleaseCommandProblem(input.migratorToml),
    findWebReleaseCommandProblem(input.flyToml),
    findMigratorAppProblem(input.migratorToml),
    findWorkflowMigrationOrderProblem(input.workflow),
    findFlyDatabaseSecretProblem(input.flyToml),
    findAlwaysOnProblem(input.flyToml),
    findKillTimeoutProblem(input),
    findFlyDatabaseSecretProblem(input.migratorToml, 'fly.migrate.toml'),
    findRuntimeRoleGateProblem(input.startTs),
    findMigrationCredentialProblem(input.migrateTs),
  ].filter((problem): problem is string => problem !== null);
}

if (import.meta.main) {
  const problems = verifyDeployConfig({
    dockerfile: readFileSync('apps/web/Dockerfile', 'utf8'),
    flyToml: readFileSync('fly.toml', 'utf8'),
    migratorToml: readFileSync('fly.migrate.toml', 'utf8'),
    workflow: readFileSync('.github/workflows/deploy-staging.yml', 'utf8'),
    bunVersion: readFileSync('.bun-version', 'utf8').trim(),
    startTs: readFileSync('apps/web/src/server/start.ts', 'utf8'),
    migrateTs: readFileSync('packages/db/scripts/migrate.ts', 'utf8'),
    shutdownBudgetTs: readFileSync(
      'apps/web/src/server/shutdown-budget.ts',
      'utf8',
    ),
  });
  if (problems.length > 0) {
    process.stderr.write(
      `Deploy config drift:\n${problems.map((problem) => `- ${problem}\n`).join('')}`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(
      'Deploy config matches .bun-version, migrates only from the migrator app, first, keeps the database role split, keeps staging always on and outlasts the shutdown drain.\n',
    );
  }
}
