import ts from 'typescript';
import type { EvidenceProblem } from './evidence';
import { browserRunnerClaimsConfig } from './browser-runner-claim';

export type BrowserRegistration = {
  readonly rootScript: string;
  readonly webScript: string;
  readonly defaultConfig: string;
  readonly dedicatedConfig: string;
  readonly runner: string;
  readonly workflow: string;
  readonly profileSource?: string;
};
export type BrowserProofContract = {
  readonly label: string;
  readonly runnerPath: string;
  readonly configPath: string;
  readonly command: string;
  readonly suites: readonly string[];
  readonly profile?: string;
  readonly reportCommand?: string;
  readonly outputDir?: string;
};
const parseConfig = (text: string) =>
  ts.createSourceFile(
    'config.ts',
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
function exportedConfig(text: string): ts.ObjectLiteralExpression | undefined {
  for (const statement of parseConfig(text).statements) {
    if (
      !ts.isExportAssignment(statement) ||
      !ts.isCallExpression(statement.expression)
    )
      continue;
    const argument = statement.expression.arguments[0];
    if (argument && ts.isObjectLiteralExpression(argument)) return argument;
  }
  return undefined;
}
function property(
  object: ts.ObjectLiteralExpression | undefined,
  key: string,
): ts.Expression | undefined {
  const found = object?.properties.find(
    (p) =>
      ts.isPropertyAssignment(p) &&
      p.name.getText().replaceAll("'", '').replaceAll('"', '') === key,
  );
  return found && ts.isPropertyAssignment(found)
    ? found.initializer
    : undefined;
}
function patterns(expression: ts.Expression | undefined): readonly string[] {
  if (expression && ts.isStringLiteral(expression)) return [expression.text];
  if (expression && ts.isArrayLiteralExpression(expression))
    return expression.elements.filter(ts.isStringLiteral).map((e) => e.text);
  return [];
}
function primaryIgnore(text: string) {
  const config = exportedConfig(text);
  const projects = property(config, 'projects');
  const primary =
    projects && ts.isArrayLiteralExpression(projects)
      ? projects.elements.find(
          (p) =>
            ts.isObjectLiteralExpression(p) &&
            patterns(property(p, 'name'))[0] === 'chromium',
        )
      : undefined;
  return patterns(
    property(
      primary && ts.isObjectLiteralExpression(primary) ? primary : config,
      'testIgnore',
    ),
  );
}
function emptyIgnore(object: ts.ObjectLiteralExpression | undefined): boolean {
  const ignored = property(object, 'testIgnore');
  return Boolean(
    ignored &&
    ts.isArrayLiteralExpression(ignored) &&
    ignored.elements.length === 0,
  );
}
function projectIgnoresCleared(
  config: ts.ObjectLiteralExpression | undefined,
): boolean {
  const projects = property(config, 'projects');
  if (projects && ts.isArrayLiteralExpression(projects))
    return (
      projects.elements.length > 0 &&
      projects.elements.every(
        (project) =>
          ts.isObjectLiteralExpression(project) && emptyIgnore(project),
      )
    );
  if (
    !projects ||
    !ts.isCallExpression(projects) ||
    !ts.isPropertyAccessExpression(projects.expression) ||
    projects.expression.name.text !== 'map'
  )
    return false;
  const callback = projects.arguments[0];
  if (!callback || !ts.isArrowFunction(callback)) return false;
  const body = ts.isParenthesizedExpression(callback.body)
    ? callback.body.expression
    : callback.body;
  return ts.isObjectLiteralExpression(body) && emptyIgnore(body);
}
const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
function hasReport(steps: readonly unknown[], command: string | undefined) {
  if (!command) return true;
  return steps.some((value) => {
    const step = record(value);
    const enforced =
      step?.if === undefined || step?.if === '${{ always() && !cancelled() }}';
    return (
      enforced && typeof step?.run === 'string' && step.run.trim() === command
    );
  });
}
function claimedSteps(
  workflow: string,
  command: string,
  reportCommand: string | undefined,
): number {
  try {
    const jobs = record(record(Bun.YAML.parse(workflow))?.jobs);
    return Object.values(jobs ?? {}).flatMap((value) => {
      const job = record(value);
      if (!job || job.if !== undefined || !Array.isArray(job.steps)) return [];
      if (!hasReport(job.steps, reportCommand)) return [];
      return job.steps.filter((value) => {
        const step = record(value);
        return (
          step &&
          step.if === undefined &&
          typeof step.run === 'string' &&
          [`bun ${command}`, `bun run ${command}`].includes(step.run.trim())
        );
      });
    }).length;
  } catch {
    return 0;
  }
}
/** Static claims supplement actual reporter counts; comments/disabled jobs never claim a run. */
export function browserProofClaimProblems(
  input: BrowserRegistration,
  contract: BrowserProofContract,
): readonly EvidenceProblem[] {
  const problems: EvidenceProblem[] = [];
  const missing = (detail: string) =>
    problems.push({ code: 'UNRUN_SUITE', detail });
  const scripts = [
    ['root', input.rootScript, 'apps/web/'],
    ['web', input.webScript, ''],
  ] as const;
  for (const [label, script, prefix] of scripts)
    if (
      !script.startsWith('bun --env-file=') ||
      script.trim().split(/\s+/).slice(2).join(' ') !==
        `${prefix}${contract.runnerPath}${contract.profile ? ` ${contract.profile}` : ''}`
    )
      missing(`${label} does not register the actual ${contract.label} runner`);
  const ignored = primaryIgnore(input.defaultConfig);
  const dedicated = exportedConfig(input.dedicatedConfig);
  if (!emptyIgnore(dedicated) || !projectIgnoresCleared(dedicated))
    missing(
      'dedicated global and project ignores must explicitly clear inherited suite exclusions',
    );
  if (
    contract.outputDir &&
    patterns(property(dedicated, 'outputDir'))[0] !== contract.outputDir
  )
    missing(
      'dedicated output directory must preserve earlier native profile evidence',
    );
  const selected = patterns(
    property(exportedConfig(input.dedicatedConfig), 'testMatch'),
  );
  for (const suite of contract.suites) {
    if (!ignored.includes(suite))
      problems.push({
        code: 'E2E_DUPLICATED',
        detail: `default Chromium still selects dedicated suite ${suite}`,
      });
    if (!selected.includes(suite))
      missing(`dedicated config does not select actual suite ${suite}`);
  }
  if (
    !browserRunnerClaimsConfig(
      input.runner,
      contract.configPath,
      contract.profile,
      input.profileSource,
    )
  )
    missing(
      `${contract.label} runner does not invoke its dedicated config through the canonical limiter`,
    );
  const jobs = claimedSteps(
    input.workflow,
    contract.command,
    contract.reportCommand,
  );
  if (jobs === 0)
    missing(
      `no unconditional CI job executes the dedicated ${contract.label} runner`,
    );
  if (jobs > 1)
    problems.push({
      code: 'E2E_DUPLICATED',
      detail: `multiple CI jobs execute the dedicated ${contract.label} runner`,
    });
  return problems;
}

/** The evidence entry supplies the checkout-local reader; missing sources stay unclaimed. */
export const readBrowserProofSources = (
  read: (path: string) => Promise<string | undefined>,
  paths: readonly string[],
) => Promise.all(paths.map(async (path) => (await read(path)) ?? ''));
