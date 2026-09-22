import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { countsByProject, countsProblems } from './e2e-report-counts';

setupRitewayBun();

const test_ = (
  projectName: string,
  results: { status: string; retry: number }[],
) => ({ projectName, results });

describe('e2e counts report', () => {
  test('tallies discovered/executed/pass/fail/skip per project', () => {
    const report = {
      suites: [
        {
          specs: [
            { tests: [test_('functional', [{ status: 'passed', retry: 0 }])] },
            { tests: [test_('functional', [{ status: 'failed', retry: 0 }])] },
            { tests: [test_('functional', [{ status: 'skipped', retry: 0 }])] },
          ],
        },
      ],
    };
    assert({
      given: 'a report with one pass, one fail and one skip in one project',
      should: 'tally each bucket correctly',
      actual: countsByProject(report),
      expected: {
        functional: {
          discovered: 3,
          executed: 2,
          passed: 1,
          failed: 1,
          skipped: 1,
          retried: 0,
        },
      },
    });
  });

  test('walks nested suites', () => {
    const report = {
      suites: [
        {
          suites: [
            {
              specs: [
                {
                  tests: [
                    test_('functional', [{ status: 'passed', retry: 0 }]),
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    assert({
      given: 'a spec nested two suites deep',
      should: 'still be counted',
      actual: countsByProject(report).functional?.discovered,
      expected: 1,
    });
  });

  test('flags a test that needed a retry to pass', () => {
    const report = {
      suites: [
        {
          specs: [
            {
              tests: [
                test_('functional', [
                  { status: 'failed', retry: 0 },
                  { status: 'passed', retry: 1 },
                ]),
              ],
            },
          ],
        },
      ],
    };
    assert({
      given: 'a test whose only passing result came from a retry',
      should: 'report RETRY_PASS',
      actual: countsProblems(countsByProject(report)).map((p) => p.code),
      expected: ['RETRY_PASS'],
    });
  });

  test('flags an empty selection', () => {
    assert({
      given: 'a report with no suites at all',
      should: 'report EMPTY_SELECTION',
      actual: countsProblems(countsByProject({ suites: [] })).map(
        (p) => p.code,
      ),
      expected: ['EMPTY_SELECTION'],
    });
  });

  test('reports nothing for a clean, non-empty, non-retried run', () => {
    const byProject = countsByProject({
      suites: [
        {
          specs: [
            { tests: [test_('functional', [{ status: 'passed', retry: 0 }])] },
          ],
        },
      ],
    });
    assert({
      given: 'a normal green run',
      should: 'report no problems',
      actual: countsProblems(byProject),
      expected: [],
    });
  });
});
