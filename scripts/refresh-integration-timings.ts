#!/usr/bin/env bun
/**
 * Rewrites scripts/integration-timings.json from successful CI runs:
 *
 *   bun scripts/refresh-integration-timings.ts <run-id> [<run-id>...]
 *
 * Each "Infrastructure contracts (N/4)" job log names its workspace before
 * that workspace's suites ("test-integration: <workspace> shard N/4: K/T
 * suites"), then prints a group per suite with its passing tests and their
 * durations. A suite's weight is the median, across the runs given, of the
 * sum of its passing test durations. These are scheduling estimates only.
 */
import { resolve } from 'node:path';

type Samples = Record<string, number[]>;

const WORKSPACE = /^test-integration: (\S+) shard \d+\/\d+: \d+\/\d+ suites$/;
const SUITE = /^##\[group\](integration\/\S+\.integration\.tsx?):$/;
const PASSED = /^\(pass\) .* \[([\d.]+)ms\]$/;

/** Each suite's summed passing test time in one job log, by repository path. */
export function suiteDurationsFromLog(log: string): Record<string, number> {
  const durations: Record<string, number> = {};
  let workspace: string | undefined;
  let suite: string | undefined;
  for (const raw of log.split('\n')) {
    // GitHub prefixes every log line with an ISO timestamp.
    const line = raw.replace(/^\d{4}-\d\d-\d\dT\S+Z /, '').trimEnd();
    const named = WORKSPACE.exec(line);
    if (named) {
      workspace = named[1];
      suite = undefined;
      continue;
    }
    const group = SUITE.exec(line);
    if (group && workspace) {
      suite = `${workspace}/${group[1]}`;
      durations[suite] = 0;
      continue;
    }
    const passed = PASSED.exec(line);
    if (passed && suite) durations[suite] += Number(passed[1]);
  }
  return durations;
}

/** The median sample per suite in whole milliseconds (at least 1), sorted by path. */
export function medianDurations(samples: Samples): Record<string, number> {
  return Object.fromEntries(
    Object.keys(samples)
      .sort()
      .map((file) => {
        const sorted = [...samples[file]].sort((a, b) => a - b);
        const middle = sorted.length / 2;
        const median =
          sorted.length % 2 === 1
            ? sorted[Math.floor(middle)]
            : (sorted[middle - 1] + sorted[middle]) / 2;
        return [file, Math.max(1, Math.round(median))];
      }),
  );
}

async function gh(args: readonly string[]): Promise<string> {
  const run = Bun.spawn(['gh', ...args], { stdout: 'pipe', stderr: 'inherit' });
  const text = await new Response(run.stdout).text();
  if ((await run.exited) !== 0) throw new Error(`gh ${args.join(' ')} failed`);
  return text;
}

if (import.meta.main) {
  const runs = process.argv.slice(2);
  if (runs.length === 0 || runs.some((run) => !/^\d+$/.test(run)))
    throw new Error(
      'Usage: bun scripts/refresh-integration-timings.ts <run-id> [<run-id>...]',
    );
  const repository = (
    await gh([
      'repo',
      'view',
      '--json',
      'nameWithOwner',
      '-q',
      '.nameWithOwner',
    ])
  ).trim();
  const samples: Samples = {};
  for (const run of runs) {
    const jobs = (
      await gh([
        'run',
        'view',
        run,
        '-R',
        repository,
        '--json',
        'jobs',
        '-q',
        '.jobs[] | select(.name | startswith("Infrastructure contracts")) | select(.conclusion == "success") | .databaseId',
      ])
    )
      .split('\n')
      .filter(Boolean);
    if (jobs.length !== 4)
      throw new Error(`Run ${run} has ${jobs.length} successful shards, not 4`);
    for (const job of jobs) {
      const log = await gh([
        'api',
        `repos/${repository}/actions/jobs/${job}/logs`,
      ]);
      for (const [file, ms] of Object.entries(suiteDurationsFromLog(log)))
        (samples[file] ??= []).push(ms);
    }
  }
  const target = resolve(import.meta.dir, 'integration-timings.json');
  await Bun.write(
    target,
    `${JSON.stringify(
      {
        source: runs.map(
          (run) => `https://github.com/${repository}/actions/runs/${run}`,
        ),
        measurement:
          'Median across the source runs of the sum of passing test durations per suite in milliseconds; scheduling estimates only. Unknown suites use 1000 ms. Refresh with bun scripts/refresh-integration-timings.ts <run-id>...',
        durationsMs: medianDurations(samples),
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(
    `refresh-integration-timings: ${Object.keys(samples).length} suites from ${runs.length} runs\n`,
  );
}
