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
    // Five shards of the one Launch profile; the cohort's number is its shard.
    command: 'bun test:e2e:room-launch "--shard=${LAUNCH_COHORT#launch-}/5"',
    report: 'room-launch-results.json',
    runnerIf: "startsWith(matrix.cohort, 'launch-')",
    reporterIf:
      "always() && !cancelled() && startsWith(matrix.cohort, 'launch-') && (steps.launch.outcome == 'success' || steps.launch.outcome == 'failure')",
  },
  {
    name: 'realtime',
    command: 'bun test:e2e:realtime',
    report: 'realtime-results.json',
    runnerIf:
      "matrix.cohort == 'realtime' && !cancelled() && steps.doctor.outcome == 'success' && steps.build.outcome == 'success' && steps.chromium.outcome == 'success'",
    reporterIf:
      "always() && !cancelled() && matrix.cohort == 'realtime' && (steps.realtime_room.outcome == 'success' || steps.realtime_room.outcome == 'failure')",
  },
  {
    name: 'messaging',
    command: 'bun test:e2e:messaging-realtime',
    report: 'messaging-realtime-results.json',
    runnerIf:
      "matrix.cohort == 'messaging' && !cancelled() && steps.doctor.outcome == 'success' && steps.build.outcome == 'success' && steps.chromium.outcome == 'success'",
    reporterIf:
      "always() && !cancelled() && matrix.cohort == 'messaging' && (steps.realtime_messaging.outcome == 'success' || steps.realtime_messaging.outcome == 'failure')",
  },
];
const condition = (value: string | undefined) =>
  value?.replace(/^\$\{\{\s*/, '').replace(/\s*\}\}$/, '') ?? null;
describe('native browser cohort evidence survives later workload', () => {
  test('each full cohort owns an independent finite job', () => {
    assert({
      given:
        'the measured Launch 155 (59 minutes in series), generic 3 and Messaging 63 workload',
      should:
        'run Launch as five shards beside the other two, independently, without fail-fast cancellation, inside a bound a PR can wait for',
      actual: {
        cohorts: job.strategy?.matrix?.cohort,
        failFast: job.strategy?.['fail-fast'],
        minutes: job['timeout-minutes'],
      },
      expected: {
        cohorts: [
          'launch-1',
          'launch-2',
          'launch-3',
          'launch-4',
          'launch-5',
          'realtime',
          'messaging',
        ],
        failFast: false,
        minutes: 45,
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
          runnerIf: condition(runner?.if),
          reporterIf: condition(reporter?.if),
        };
      }),
      expected: cohorts.map(({ name, runnerIf, reporterIf }) => ({
        name,
        runnerIf,
        reporterIf,
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
