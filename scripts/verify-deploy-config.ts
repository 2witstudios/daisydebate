import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import ts from 'typescript';
import { findRuntimeRoleGateProblem } from './runtime-role-gate';

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
  return killTimeoutSeconds(input.flyToml) >= required
    ? null
    : `fly.toml kill_timeout must be at least ${required} s (the ${drainSeconds} s shutdown drain plus ${KILL_TIMEOUT_MARGIN_S} s margin); Fly SIGKILLs a machine that has not exited by then (ISSUE-214)`;
}

/** A top-level kill_timeout in seconds, or Fly's 5 s default. */
const killTimeoutSeconds = (toml: string) => {
  const topLevel = uncommented(toml).split(/^\s*\[/m)[0] ?? '';
  const setting = topLevel.match(
    /^\s*kill_timeout\s*=\s*(?:(\d+)|"(\d+)s")\s*$/m,
  );
  return Number(setting?.[1] ?? setting?.[2] ?? 5);
};

/**
 * ISSUE-528: the staging apps beside web and the migrator. Each deploys
 * from deploy-staging.yml with its own app-scoped token. The two built from
 * apps/web/Dockerfile name their stage and the line of source that bounds
 * how long they take to stop; LiveKit is a pinned third-party image.
 */
export const SERVICE_APPS = [
  {
    file: 'fly.livekit.toml',
    token: 'FLY_LIVEKIT_API_TOKEN',
    target: null,
    stop: null,
  },
  {
    file: 'fly.realtime.toml',
    token: 'FLY_REALTIME_API_TOKEN',
    target: 'realtime',
    stop: {
      source: 'apps/realtime/src/start.ts',
      pattern: /deadlineMs: ([\d_]+),/,
    },
  },
  {
    file: 'fly.media-worker.toml',
    token: 'FLY_MEDIA_WORKER_API_TOKEN',
    target: 'media-worker',
    stop: {
      source: 'apps/media-worker/src/worker.ts',
      pattern: /child\.kill\('SIGKILL'\), ([\d_]+)\)/,
    },
  },
] as const;

/**
 * Pure check of one service app config: it builds its own stage, keeps
 * database credentials and migrations out, and lets Fly wait past its stop
 * budget before SIGKILL (ISSUE-214's rule, per app).
 */
export function findServiceAppProblems(input: {
  readonly file: string;
  readonly toml: string;
  readonly target: string;
  readonly stopMs: number;
}): readonly string[] {
  const code = uncommented(input.toml);
  const build = uncommented(
    (tableBody(input.toml, '[build]') ?? []).join('\n'),
  );
  const env = uncommented((tableBody(input.toml, '[env]') ?? []).join('\n'));
  const credential = env.match(/^\s*([A-Z_]*DATABASE_URL)\s*=/m);
  const stopSeconds = Math.ceil(input.stopMs / 1000);
  const required = stopSeconds + KILL_TIMEOUT_MARGIN_S;
  return [
    /^\s*dockerfile\s*=\s*"apps\/web\/Dockerfile"\s*$/m.test(build) &&
    new RegExp(`^\\s*build-target\\s*=\\s*"${input.target}"\\s*$`, 'm').test(build)
      ? null
      : `${input.file} must build \`build-target = "${input.target}"\` from apps/web/Dockerfile`,
    credential
      ? `${input.file} [env] sets ${credential[1]}; database credentials are Fly secrets`
      : null,
    /^\s*release_command\s*=/m.test(code)
      ? `${input.file} runs a release_command; migrations run only from fly.migrate.toml`
      : null,
    killTimeoutSeconds(input.toml) >= required
      ? null
      : `${input.file} kill_timeout must be at least ${required} s (the ${stopSeconds} s stop budget plus ${KILL_TIMEOUT_MARGIN_S} s margin)`,
  ].filter((problem): problem is string => problem !== null);
}

/** Every committed service app checked against its own source's stop budget. */
export function findServiceAppConfigProblems(
  read: (path: string) => string | undefined,
): readonly string[] {
  return SERVICE_APPS.flatMap((app) => {
    if (app.target === null || app.stop === null)
      return read(app.file) === undefined ? [`${app.file} is missing`] : [];
    const stop = uncommented(read(app.stop.source) ?? '').match(
      app.stop.pattern,
    );
    if (!stop)
      return [
        `${app.stop.source} no longer states its stop budget as ${app.stop.pattern}`,
      ];
    return findServiceAppProblems({
      file: app.file,
      toml: read(app.file) ?? '',
      target: app.target,
      stopMs: Number(stop[1]?.replaceAll('_', '')),
    });
  });
}

/**
 * ISSUE-528: deploy-staging.yml deploys each service app after the
 * migration, each step holding only that app's deploy token.
 */
export function findServiceDeployProblems(workflow: string): readonly string[] {
  const code = uncommented(workflow);
  const migrate = code.search(
    /flyctl deploy -c fly\.migrate\.toml[^\n]*--update-only/,
  );
  const steps = code.split(/^\s*- (?=id:|name:|uses:)/m);
  return SERVICE_APPS.flatMap((app) => {
    const deploy = code.indexOf(`flyctl deploy -c ${app.file} `);
    const own = steps.find((step) =>
      step.includes(`flyctl deploy -c ${app.file} `),
    );
    return migrate !== -1 &&
      deploy > migrate &&
      own?.includes(`FLY_API_TOKEN: \${{ secrets.${app.token} }}`)
      ? []
      : [
          `deploy-staging.yml must deploy ${app.file} after the migration, with its own secrets.${app.token}`,
        ];
  });
}

/**
 * ISSUE-527: the image's `next build` skips its own TypeScript pass, which
 * stalled Fly's remote builder for 25+ minutes and is a duplicate: CI's
 * typecheck gates every commit deploy-staging ships (staging-gate.ts). The
 * skip must stay scoped to the image, so `bun run build` and `bun check`
 * still typecheck: next.config.ts keys it on DAISY_IMAGE_BUILD alone, and
 * only the Dockerfile's build stage sets that.
 */
export function findImageTypecheckProblem(input: {
  readonly dockerfile: string;
  readonly nextConfig: string;
}): string | null {
  const config = uncommented(input.nextConfig);
  const scoped =
    /ignoreBuildErrors:\s*process\.env\.DAISY_IMAGE_BUILD === '1'/.test(
      config,
    ) && (config.match(/ignoreBuildErrors/g) ?? []).length === 1;
  const docker = uncommented(input.dockerfile);
  const settings = docker.match(/DAISY_IMAGE_BUILD=1/g) ?? [];
  const inBuild =
    /RUN DAISY_IMAGE_BUILD=1 NODE_ENV=production bun run --cwd apps\/web build/.test(
      docker,
    );
  return scoped && inBuild && settings.length === 1
    ? null
    : "next.config.ts must skip type errors only for the image build (ignoreBuildErrors: process.env.DAISY_IMAGE_BUILD === '1'), and only the Dockerfile build stage may set DAISY_IMAGE_BUILD=1; CI typechecks every deployed commit";
}

/** The alert probe and the Incidents poster it spawns (ISSUE-225). */
const PROBE_ENTRIES = [
  'scripts/auth-alert-probe.ts',
  'scripts/notify-drive.ts',
] as const;

/** A specifier that needs no installed package. */
const isBuiltin = (specifier: string) =>
  specifier.startsWith('node:') ||
  specifier === 'bun' ||
  specifier.startsWith('bun:');

/**
 * Every module specifier a file loads at run time: static imports and
 * re-exports (not whole-statement `import type`/`export type`, which the
 * transpiler erases), dynamic `import()` and `require()` of a literal.
 */
function runtimeSpecifiers(path: string, source: string): string[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isImportDeclaration(node) &&
      !node.importClause?.isTypeOnly &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      specifiers.push(node.moduleSpecifier.text);
    else if (
      ts.isExportDeclaration(node) &&
      !node.isTypeOnly &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      specifiers.push(node.moduleSpecifier.text);
    else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === 'require')) &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    )
      specifiers.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return specifiers;
}

/**
 * ISSUE-225: the AUTH-7.7 probe and notify-drive must run with nothing
 * installed, so a registry outage can never stop the probe from posting.
 * Walks their runtime import graph from the repository root (`read` takes
 * a root-relative path) and reports every bare package specifier and every
 * relative import that does not resolve; only relative modules and
 * `node:`/`bun` builtins are allowed.
 */
export function findProbeImportProblems(
  read: (path: string) => string | undefined,
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const pending: string[] = [...PROBE_ENTRIES];
  const resolveModule = (from: string, specifier: string) =>
    [
      posix.join(posix.dirname(from), specifier),
      `${posix.join(posix.dirname(from), specifier)}.ts`,
      posix.join(posix.dirname(from), specifier, 'index.ts'),
    ].find((candidate) => read(candidate) !== undefined);
  for (let path = pending.shift(); path; path = pending.shift()) {
    if (seen.has(path)) continue;
    seen.add(path);
    for (const specifier of runtimeSpecifiers(path, read(path) ?? '')) {
      if (isBuiltin(specifier)) continue;
      if (!specifier.startsWith('.')) {
        problems.push(`${path} imports package '${specifier}'`);
        continue;
      }
      const target = resolveModule(path, specifier);
      if (target) pending.push(target);
      else
        problems.push(
          `${path} imports '${specifier}', which does not resolve to a file`,
        );
    }
  }
  return problems.sort();
}

/**
 * ISSUE-225: `auth-alerts.yml` installs nothing and runs the probe with
 * `--no-install`, so nothing is ever fetched from the registry; its Bun
 * comes from `.bun-version`.
 */
export function findProbeWorkflowProblem(workflow: string): string | null {
  const code = uncommented(workflow);
  const probes = [...code.matchAll(/^.*scripts\/auth-alert-probe\.ts.*$/gm)];
  const problems = [
    /oven-sh\/setup-bun@[0-9a-f]{40}[^\n]*\n\s*with:\s*\n\s*bun-version-file:\s*['"]?\.bun-version['"]?/.test(
      code,
    )
      ? null
      : 'sets up Bun without `bun-version-file: .bun-version`',
    /\bbun (?:install|i|add)\b/.test(code)
      ? 'installs packages (the probe needs none)'
      : null,
    probes.length === 0 ? 'never runs scripts/auth-alert-probe.ts' : null,
    probes.every(([line]) =>
      /\bbun --no-install scripts\/auth-alert-probe\.ts\b/.test(line),
    )
      ? null
      : 'runs the probe without `bun --no-install`',
  ].filter((problem): problem is string => problem !== null);
  return problems.length === 0
    ? null
    : `auth-alerts.yml ${problems.join('; ')} (ISSUE-225)`;
}

export function verifyDeployConfig(input: {
  readonly dockerfile: string;
  readonly nextConfig: string;
  readonly flyToml: string;
  readonly migratorToml: string;
  readonly workflow: string;
  readonly probeWorkflow: string;
  /** Reads a root-relative repository file, or undefined when it is absent. */
  readonly readRepoFile: (path: string) => string | undefined;
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
    findImageTypecheckProblem(input),
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
    findProbeWorkflowProblem(input.probeWorkflow),
    ...findProbeImportProblems(input.readRepoFile),
    ...findServiceAppConfigProblems(input.readRepoFile),
    ...findServiceDeployProblems(input.workflow),
  ].filter((problem): problem is string => problem !== null);
}

if (import.meta.main) {
  const problems = verifyDeployConfig({
    dockerfile: readFileSync('apps/web/Dockerfile', 'utf8'),
    nextConfig: readFileSync('apps/web/next.config.ts', 'utf8'),
    flyToml: readFileSync('fly.toml', 'utf8'),
    migratorToml: readFileSync('fly.migrate.toml', 'utf8'),
    workflow: readFileSync('.github/workflows/deploy-staging.yml', 'utf8'),
    probeWorkflow: readFileSync('.github/workflows/auth-alerts.yml', 'utf8'),
    readRepoFile: (path) => {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return undefined;
      }
    },
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
      'Deploy config matches .bun-version, migrates only from the migrator app, first, keeps the database role split, keeps staging always on, outlasts the shutdown drain, deploys every service app with its own token and runs the alert probe with nothing installed.\n',
    );
  }
}
