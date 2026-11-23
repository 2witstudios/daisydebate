import { expect } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
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
  strategy?: {
    'fail-fast'?: boolean;
    matrix?: { cohort?: string[]; include?: string };
  };
  'timeout-minutes'?: string;
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
        prMinutes: Number(
          runInNewContext(
            condition(job['timeout-minutes']) ?? '',
            {
              matrix: { cohort: 'launch-1' },
            },
            { timeout: 500 },
          ),
        ),
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
        prMinutes: 45,
      },
    });
  });
  test('only the scheduled matrix includes the three drills', () => {
    const drill = job.steps.find(({ id }) => id === 'node_kill');
    const include = condition(job.strategy?.matrix?.include) ?? '';
    const cohortsFor = (event: string): unknown =>
      runInNewContext(
        include,
        {
          github: { event_name: event },
          fromJSON: JSON.parse,
        },
        { timeout: 500 },
      );
    expect(cohortsFor('schedule')).toEqual([
      { cohort: 'node-kill' },
      { cohort: 'first-word', speech: 'espeak-ng' },
      { cohort: 'bot-freestyle', speech: 'espeak-ng' },
    ]);
    for (const event of ['pull_request', 'push', 'workflow_dispatch'])
      expect(cohortsFor(event)).toEqual([]);
    expect(condition(drill?.if)).toBe("matrix.cohort == 'node-kill'");
    expect(drill?.run).toContain('local-nodes.sh');
    expect(drill?.run).toContain('bun drill:node-kill');
    expect(drill?.run).toContain('down');
  });
  test('the speech drills run on espeak-ng inside the nightly bound', () => {
    const install = job.steps.find(({ id }) => id === 'chromium');
    const first = job.steps.find(({ id }) => id === 'first_word');
    const minutes = (matrix: Record<string, string>) =>
      Number(
        runInNewContext(condition(job['timeout-minutes']) ?? '', { matrix }),
      );
    assert({
      given: 'the first-word and bot Freestyle cohorts',
      should:
        'install their speech package through the bounded installer, run each drill in its own cohort, and bound the job above the queue deadline',
      actual: {
        extra: (install as { env?: Record<string, string> })?.env
          ?.EXTRA_PACKAGES,
        firstIf: condition(first?.if),
        firstRun: first?.run,
        speechMinutes: minutes({ cohort: 'first-word', speech: 'espeak-ng' }),
        launchMinutes: minutes({ cohort: 'launch-1' }),
      },
      expected: {
        extra: '${{ matrix.speech }}',
        firstIf: "matrix.cohort == 'first-word'",
        firstRun: 'bun drill:first-word',
        speechMinutes: 100,
        launchMinutes: 45,
      },
    });
  });
  test('the bot Freestyle drill passes as not run without its key, and runs with it', () => {
    const step = job.steps.find(({ id }) => id === 'bot_freestyle') as
      (Step & { env?: Record<string, string> }) | undefined;
    const root = mkdtempSync(join(tmpdir(), 'daisy-bot-drill-'));
    try {
      writeFileSync(
        join(root, 'bun'),
        '#!/bin/sh\necho "bun $*" >> "$CALLS"\n',
      );
      chmodSync(join(root, 'bun'), 0o755);
      const run = (key: string) => {
        const calls = join(root, `calls-${String(key.length)}`);
        const output = join(root, `output-${String(key.length)}`);
        const summary = join(root, `summary-${String(key.length)}`);
        writeFileSync(calls, '');
        const result = Bun.spawnSync(['sh', '-ec', step?.run ?? 'exit 9'], {
          env: {
            PATH: `${root}:/usr/bin:/bin`,
            CALLS: calls,
            GITHUB_OUTPUT: output,
            GITHUB_STEP_SUMMARY: summary,
            E2E_OPENROUTER_API_KEY: key,
          },
        });
        return {
          exitCode: result.exitCode,
          printed: result.stdout.toString().includes('not run: no key'),
          leaked: key !== '' && result.stdout.toString().includes(key),
          calls: readFileSync(calls, 'utf8'),
          ran: readFileSync(output, 'utf8'),
          summary:
            existsSync(summary) &&
            readFileSync(summary, 'utf8').includes('not run: no key'),
        };
      };
      assert({
        given: 'the nightly bot Freestyle step, with and without the secret',
        should:
          'read only the named repository secret; without it say "not run: no key" and pass without the drill; with it run the drill and never print the key',
        actual: {
          if: condition(step?.if),
          secret: step?.env?.E2E_OPENROUTER_API_KEY,
          absent: run(''),
          present: run('sk-or-test-key'),
        },
        expected: {
          if: "matrix.cohort == 'bot-freestyle'",
          secret: '${{ secrets.E2E_OPENROUTER_API_KEY }}',
          absent: {
            exitCode: 0,
            printed: true,
            leaked: false,
            calls: '',
            ran: 'ran=false\n',
            summary: true,
          },
          present: {
            exitCode: 0,
            printed: false,
            leaked: false,
            calls: 'bun drill:bot-freestyle\n',
            ran: 'ran=true\n',
            summary: false,
          },
        },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
