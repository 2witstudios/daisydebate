import ts from 'typescript';
import type { EvidenceProblem } from './evidence';

type Registration = {
  readonly rootScript: string;
  readonly webScript: string;
  readonly defaultConfig: string;
  readonly dedicatedConfig: string;
  readonly runner: string;
  readonly workflow: string;
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
function launchJobs(workflow: string): number {
  try {
    const jobs = record(record(Bun.YAML.parse(workflow))?.jobs);
    return Object.values(jobs ?? {}).flatMap((value) => {
      const job = record(value);
      if (!job || job.if !== undefined || !Array.isArray(job.steps)) return [];
      return job.steps.filter((value) => {
        const step = record(value);
        return (
          step &&
          step.if === undefined &&
          typeof step.run === 'string' &&
          /^bun (?:run )?test:e2e:room-launch\s*$/.test(step.run.trim())
        );
      });
    }).length;
  } catch {
    return 0;
  }
}
function runnerInvokesConfig(text: string): boolean {
  let claimed = false;
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText() === 'Bun.spawn'
    ) {
      const argument = node.arguments[0];
      if (argument && ts.isArrayLiteralExpression(argument)) {
        const args = argument.elements
          .filter(ts.isStringLiteral)
          .map((e) => e.text);
        claimed =
          args.includes('../../scripts/e2e-limit.ts') &&
          args.includes('--config') &&
          args.includes('e2e/support/room-launch-config.ts');
      }
    }
    if (!claimed) ts.forEachChild(node, visit);
  };
  visit(parseConfig(text));
  return claimed;
}
/** Static claims supplement actual reporter counts; comments/disabled jobs never claim a run. */
export function roomLaunchClaimProblems(
  input: Registration,
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
      script.trim().split(/\s+/).at(-1) !==
        `${prefix}e2e/support/room-launch-runner.ts` ||
      script.trim().split(/\s+/).length !== 3
    )
      missing(`${label} does not register the actual Launch runner`);
  const ignored = primaryIgnore(input.defaultConfig);
  const dedicated = exportedConfig(input.dedicatedConfig);
  if (!emptyIgnore(dedicated) || !projectIgnoresCleared(dedicated))
    missing(
      'dedicated global and project ignores must explicitly clear inherited suite exclusions',
    );
  const selected = patterns(
    property(exportedConfig(input.dedicatedConfig), 'testMatch'),
  );
  for (const suite of ['**/room-launch.e2e.ts', '**/debate-room.e2e.ts']) {
    if (!ignored.includes(suite))
      problems.push({
        code: 'E2E_DUPLICATED',
        detail: `default Chromium still selects dedicated suite ${suite}`,
      });
    if (!selected.includes(suite))
      missing(`dedicated config does not select actual suite ${suite}`);
  }
  if (!runnerInvokesConfig(input.runner))
    missing(
      'Launch runner does not invoke its dedicated config through the canonical limiter',
    );
  const jobs = launchJobs(input.workflow);
  if (jobs === 0)
    missing('no unconditional CI job executes the dedicated Launch runner');
  if (jobs > 1)
    problems.push({
      code: 'E2E_DUPLICATED',
      detail: 'multiple CI jobs execute the dedicated Launch runner',
    });
  return problems;
}
