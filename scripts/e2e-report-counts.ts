/**
 * AUTH-6.1: reads Playwright's own JSON reporter output and reports
 * discovered/executed/pass/fail/skip counts by project, rejecting an empty
 * selection (a misconfigured testMatch that silently "passes" zero tests)
 * and proving no reported test needed a retry to pass (retries are disabled
 * in CI; this is redundant-but-explicit, per the release contract that a
 * retry-pass is not release proof).
 */
type PlaywrightResult = { status: string; retry: number };
type PlaywrightTest = { results: PlaywrightResult[]; projectName?: string };
type PlaywrightSpec = { tests: PlaywrightTest[] };
type PlaywrightSuite = { specs?: PlaywrightSpec[]; suites?: PlaywrightSuite[] };
type PlaywrightReport = {
  suites: PlaywrightSuite[];
  stats?: {
    expected?: number;
    unexpected?: number;
    skipped?: number;
    flaky?: number;
  };
};

export type ProjectCounts = {
  discovered: number;
  executed: number;
  passed: number;
  failed: number;
  skipped: number;
  retried: number;
};

function collectSpecs(suite: PlaywrightSuite): PlaywrightSpec[] {
  return [
    ...(suite.specs ?? []),
    ...(suite.suites ?? []).flatMap(collectSpecs),
  ];
}

export function countsByProject(
  report: PlaywrightReport,
): Readonly<Record<string, ProjectCounts>> {
  const byProject: Record<string, ProjectCounts> = {};
  for (const suite of report.suites)
    for (const spec of collectSpecs(suite))
      for (const test of spec.tests) {
        const project = test.projectName ?? 'default';
        const counts = (byProject[project] ??= {
          discovered: 0,
          executed: 0,
          passed: 0,
          failed: 0,
          skipped: 0,
          retried: 0,
        });
        counts.discovered += 1;
        const last = test.results.at(-1);
        if (!last || last.status === 'skipped') {
          counts.skipped += 1;
          continue;
        }
        counts.executed += 1;
        if (last.status === 'passed') counts.passed += 1;
        else counts.failed += 1;
        if (test.results.length > 1 || last.retry > 0) counts.retried += 1;
      }
  return byProject;
}

export type CountsProblem = {
  code: 'EMPTY_SELECTION' | 'RETRY_PASS';
  detail: string;
};

export function countsProblems(
  byProject: Readonly<Record<string, ProjectCounts>>,
): readonly CountsProblem[] {
  const problems: CountsProblem[] = [];
  const projects = Object.entries(byProject);
  if (projects.length === 0 || projects.every(([, c]) => c.discovered === 0))
    problems.push({
      code: 'EMPTY_SELECTION',
      detail: 'no tests were discovered; the E2E project selection is empty',
    });
  for (const [project, counts] of projects)
    if (counts.retried > 0)
      problems.push({
        code: 'RETRY_PASS',
        detail: `${project}: ${counts.retried} test(s) needed a retry; a retry-pass is not release proof`,
      });
  return problems;
}

export function formatCounts(
  byProject: Readonly<Record<string, ProjectCounts>>,
): string {
  const lines = [
    '| Project | Discovered | Executed | Pass | Fail | Skip |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const [project, c] of Object.entries(byProject))
    lines.push(
      `| ${project} | ${c.discovered} | ${c.executed} | ${c.passed} | ${c.failed} | ${c.skipped} |`,
    );
  return lines.join('\n');
}

if (import.meta.main) {
  const path = process.argv[2];
  if (!path) {
    console.error(
      'usage: bun scripts/e2e-report-counts.ts <playwright-json-report>',
    );
    process.exitCode = 1;
  } else {
    const report = JSON.parse(await Bun.file(path).text()) as PlaywrightReport;
    const byProject = countsByProject(report);
    const table = formatCounts(byProject);
    console.log(table);
    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (summaryPath) {
      const { appendFileSync } = await import('node:fs');
      appendFileSync(summaryPath, `\n## Auth E2E counts\n\n${table}\n`);
    }
    const problems = countsProblems(byProject);
    for (const problem of problems)
      console.error(`${problem.code}: ${problem.detail}`);
    process.exitCode = problems.length === 0 ? 0 : 1;
  }
}
