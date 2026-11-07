import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
setupRitewayBun();
type Step = {
  id?: string;
  name?: string;
  run?: string;
  if?: string;
  uses?: string;
  with?: Record<string, string>;
};
type Job = {
  strategy?: { 'fail-fast'?: boolean; matrix?: { cohort?: string[] } };
  'timeout-minutes'?: number;
  steps: Step[];
  needs?: string[];
};
const workflow = Bun.YAML.parse(
  await Bun.file('.github/workflows/e2e.yml').text(),
) as { jobs: Record<string, Job> };
const job = workflow.jobs['room-launch']!;
const cohorts = [
  {
    name: 'launch',
    command: 'bun test:e2e:room-launch',
    report: 'room-launch-results.json',
  },
  {
    name: 'realtime',
    command: 'bun test:e2e:realtime',
    report: 'realtime-results.json',
  },
  {
    name: 'messaging',
    command: 'bun test:e2e:messaging-realtime',
    report: 'messaging-realtime-results.json',
  },
];
describe('native browser cohort evidence survives later workload', () => {
  test('each full cohort owns an independent finite job', () => {
    assert({
      given: 'the measured Launch150, generic3 and Messaging63 workload',
      should:
        'run all three independently without fail-fast cancellation or a larger deadline',
      actual: {
        cohorts: job.strategy?.matrix?.cohort,
        failFast: job.strategy?.['fail-fast'],
        minutes: job['timeout-minutes'],
      },
      expected: {
        cohorts: ['launch', 'realtime', 'messaging'],
        failFast: false,
        minutes: 70,
      },
    });
  });
  test('each job runs and reports only its own full profile', () => {
    assert({
      given: 'the native matrix job at one exact source head',
      should:
        'keep every full profile and gate each runner/report to its own cohort',
      actual: cohorts.map(({ name, command, report }) => {
        const runner = job.steps.find((step) => step.run === command);
        const reporter = job.steps.find(
          (step) =>
            step.run ===
            `bun scripts/e2e-report-counts.ts apps/web/test-results/${report}`,
        );
        return {
          name,
          runner: runner?.if?.includes(`matrix.cohort == '${name}'`) === true,
          report: reporter?.if?.includes(`matrix.cohort == '${name}'`) === true,
          reportAlways: reporter?.if?.includes('always()') === true,
        };
      }),
      expected: cohorts.map(({ name }) => ({
        name,
        runner: true,
        report: true,
        reportAlways: true,
      })),
    });
  });
  test('sanitized evidence has a distinct artifact per cohort and a shared required gate', () => {
    const sanitize = job.steps.findIndex(
      (step) => step.id === 'sanitize_launch',
    );
    const upload = job.steps.findIndex((step) =>
      step.uses?.startsWith('actions/upload-artifact@'),
    );
    const artifact = job.steps[upload];
    assert({
      given: 'one completed cohort with later cohorts on other workers',
      should:
        'sanitize before uniquely retaining its artifacts and require success of the full matrix',
      actual: {
        sanitizeBeforeUpload: sanitize >= 0 && upload > sanitize,
        sanitizerRequired:
          artifact?.if?.includes(
            "steps.sanitize_launch.outcome == 'success'",
          ) === true,
        unique: artifact?.with?.name?.includes('matrix.cohort') === true,
        gate: workflow.jobs['native-gate']?.needs,
      },
      expected: {
        sanitizeBeforeUpload: true,
        sanitizerRequired: true,
        unique: true,
        gate: ['room-launch'],
      },
    });
  });
});
