import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import ts from 'typescript';

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
 * compose, prepare or listen on its own. It calls it exactly once, sets
 * refuseRole once with no spread that could override it, and the refusal is
 * @daisy/db's own, never a local or imported no-op (ISSUE-206).
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
  if (
    !code.includes('startProductionServer({') ||
    !code.includes(REFUSAL) ||
    !code.includes('await started;')
  )
    return "start.ts does not start through startProductionServer with refuseRole: () => refuseSchemaAlteringRole(app, 'daisy_web') and await started";
  // ISSUE-206: the checked refusal must be the only one that can run.
  if (occurrences(code, 'startProductionServer(') !== 1)
    return 'start.ts must call startProductionServer exactly once; a second call starts a server the checked refusal does not guard (ISSUE-206)';
  const options = callArguments(code, 'startProductionServer(');
  if (occurrences(options, 'refuseRole') !== 1 || options.includes('...'))
    return "start.ts's startProductionServer call sets refuseRole more than once or spreads other options into it; only refuseRole: () => refuseSchemaAlteringRole(app, 'daisy_web') may set it (ISSUE-206)";
  if (
    !code.includes("import { refuseSchemaAlteringRole } from '@daisy/db';") ||
    occurrences(code, 'refuseSchemaAlteringRole') !== 2
  )
    return 'start.ts must import refuseSchemaAlteringRole from @daisy/db and use it only as the refuseRole (ISSUE-206)';
  return null;
}

const REFUSAL = "refuseRole: () => refuseSchemaAlteringRole(app, 'daisy_web'),";

const occurrences = (text: string, needle: string) =>
  text.split(needle).length - 1;

/** The source text between a call's parentheses, by bracket depth. */
const callArguments = (code: string, callee: string): string => {
  const start = code.indexOf(callee) + callee.length;
  let depth = 1;
  for (let index = start; index < code.length; index++) {
    const char = code[index];
    if (char === '(' || char === '{' || char === '[') depth++;
    else if (char === ')' || char === '}' || char === ']') depth--;
    if (depth === 0) return code.slice(start, index);
  }
  return code.slice(start);
};

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
  readonly flyToml: string;
  readonly migratorToml: string;
  readonly workflow: string;
  readonly probeWorkflow: string;
  /** Reads a root-relative repository file, or undefined when it is absent. */
  readonly readRepoFile: (path: string) => string | undefined;
  readonly bunVersion: string;
  readonly startTs: string;
  readonly migrateTs: string;
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
    findFlyDatabaseSecretProblem(input.migratorToml, 'fly.migrate.toml'),
    findRuntimeRoleGateProblem(input.startTs),
    findMigrationCredentialProblem(input.migrateTs),
    findProbeWorkflowProblem(input.probeWorkflow),
    ...findProbeImportProblems(input.readRepoFile),
  ].filter((problem): problem is string => problem !== null);
}

if (import.meta.main) {
  const problems = verifyDeployConfig({
    dockerfile: readFileSync('apps/web/Dockerfile', 'utf8'),
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
  });
  if (problems.length > 0) {
    process.stderr.write(
      `Deploy config drift:\n${problems.map((problem) => `- ${problem}\n`).join('')}`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(
      'Deploy config matches .bun-version, migrates only from the migrator app, first, keeps the database role split, keeps staging always on and runs the alert probe with nothing installed.\n',
    );
  }
}
