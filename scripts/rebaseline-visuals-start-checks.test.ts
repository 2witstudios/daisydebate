import { setDefaultTimeout } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { type Job, runStep, workflow } from './rebaseline-visuals.test-support';

setupRitewayBun();
// A full wait runs 24 passes of real jq, which a loaded machine stretches.
setDefaultTimeout(30_000);

/**
 * Runs the approval step against a stub `gh` answering `pulls` and `runs`.
 * `failOnce` fails the first call of that kind, as a transient API error does,
 * and `stale head` answers the first lookup with an older pull request head.
 * Returns the exit status and each run the step asked GitHub to approve.
 */
const approveRun = (
  pulls: unknown[],
  runs: unknown[],
  failOnce?: 'pulls' | 'runs' | 'approve' | 'every approve' | 'stale head',
  pushed = true,
) => {
  const step = workflow.jobs['start-checks']!.steps.find(
    ({ id }) => id === 'approve',
  )!;
  return runStep(
    step,
    (dir) => {
      const fail = (kind: string) =>
        failOnce === `every ${kind}`
          ? 'exit 1; '
          : failOnce === kind
            ? `[ -e '${dir}/failed' ] || { touch '${dir}/failed'; exit 1; }; `
            : '';
      const staleHead =
        failOnce === 'stale head'
          ? `[ -e '${dir}/stale' ] || { touch '${dir}/stale'; echo '${JSON.stringify(openPull('b'.repeat(40)))}'; exit 0; }; `
          : '';
      writeFileSync(join(dir, 'calls'), '');
      return {
        stubs: {
          gh: `echo "$*" >> '${dir}/calls'
case "$*" in
  *"/pulls?state=open&head=owner:pu/lobby") ${fail('pulls')}${staleHead}echo '${JSON.stringify(pulls)}' ;;
  *"/actions/workflows/ci.yml/runs?per_page=100") ${fail('runs')}echo '${JSON.stringify({ workflow_runs: runs })}' ;;
  *"/approve") ${fail('approve')}: ;;
esac`,
          sleep: ':',
        },
        env: {
          GITHUB_REPOSITORY_OWNER: 'owner',
          SHA: 'a'.repeat(40),
          BRANCH: 'pu/lobby',
          PUSHED: String(pushed),
        },
      };
    },
    (dir) => ({
      approved: readFileSync(join(dir, 'calls'), 'utf8')
        .split('\n')
        .filter((call) => call.startsWith('api --method POST'))
        .map((call) => call.match(/runs\/(\d+)\/approve/)?.[1]),
      listings: readFileSync(join(dir, 'calls'), 'utf8')
        .split('\n')
        .filter((call) => call.includes('/runs?per_page=')).length,
    }),
  );
};

const runApprove = (...args: Parameters<typeof approveRun>) => {
  const { ok, approved } = approveRun(...args);
  return { ok, approved };
};

const openPull = (sha = 'a'.repeat(40)) => [{ head: { sha } }];

const prRun = (
  id: number,
  status: string,
  conclusion: string | null,
  head_sha = 'a'.repeat(40),
  repo = 'owner/daisy',
) => ({
  id,
  status,
  conclusion,
  head_sha,
  event: 'pull_request',
  head_repository: { full_name: repo },
});
const held = (id: number, head_sha?: string) =>
  prRun(id, 'completed', 'action_required', head_sha);

describe('Rebaseline visuals start-checks', () => {
  test('the job that holds actions: write', () => {
    const job = workflow.jobs['start-checks']!;
    assert({
      given: 'the start-checks job',
      should:
        'check out nothing and run on any resolved target, even when nothing was pushed',
      actual: {
        condition: (job as Job & { if?: string }).if,
        uses: job.steps.flatMap((step) => (step.uses ? [step.uses] : [])),
        head: job.steps[0]?.env?.SHA,
      },
      expected: {
        condition: "${{ !cancelled() && needs.resolve.result == 'success' }}",
        uses: [],
        head: '${{ needs.commit.outputs.sha || needs.resolve.outputs.sha }}',
      },
    });
  });

  test('a CI run held at the head', () => {
    assert({
      given: 'CI held at the head',
      should: 'approve it and finish',
      actual: runApprove(openPull(), [held(11)]),
      expected: { ok: true, approved: ['11'] },
    });
  });

  test('a CI run already running', () => {
    assert({
      given: 'CI running at the head, as after a person pushed it',
      should: 'finish without approving anything',
      actual: runApprove(openPull(), [prRun(11, 'in_progress', null)]),
      expected: { ok: true, approved: [] },
    });
  });

  for (const status of ['queued', 'requested', 'pending']) {
    test(`a CI run still ${status}`, () => {
      assert({
        given: `CI ${status} for the whole wait and never held`,
        should: 'keep watching, then finish without approving anything',
        actual: runApprove(openPull(), [prRun(11, status, null)]),
        expected: { ok: true, approved: [] },
      });
    });
  }

  test('a held run at another commit', () => {
    assert({
      given: 'CI held only at some other pull request head',
      should: 'never approve that run, and fail when its own never appears',
      actual: runApprove(openPull(), [held(11, 'b'.repeat(40))]),
      expected: { ok: false, approved: [] },
    });
  });

  test('a held run from a fork at the same commit', () => {
    const fork = prRun(
      11,
      'completed',
      'action_required',
      undefined,
      'someone/daisy',
    );
    assert({
      given: 'CI held for a fork pull request at the head commit',
      should: 'never approve the fork run past GitHub first-time approval',
      actual: runApprove(openPull(), [fork], undefined, false),
      expected: { ok: true, approved: [] },
    });
  });

  test('a held run at a head the branch has moved past', () => {
    assert({
      given: 'CI held at the commit while the pull request head is newer',
      should:
        'approve nothing, so that run cannot cancel the new head CI, and finish',
      actual: runApprove(openPull('b'.repeat(40)), [held(11)]),
      expected: { ok: true, approved: [] },
    });
  });

  test('a fresh push that reads as the old head for a moment', () => {
    assert({
      given: 'a first lookup that reads an older head, then the pushed one',
      should: 'look again and approve the held run',
      actual: runApprove(openPull(), [held(11)], 'stale head'),
      expected: { ok: true, approved: ['11'] },
    });
  });

  test('a stale read followed by no CI run', () => {
    assert({
      given: 'a first lookup that reads an older head, and CI never appearing',
      should: 'fail, because the branch did not move past the pushed head',
      actual: runApprove(openPull(), [], 'stale head').ok,
      expected: false,
    });
  });

  test('every approval refused', () => {
    const refused = (pushed: boolean) =>
      runApprove(openPull(), [held(11)], 'every approve', pushed).ok;
    assert({
      given: 'GitHub refusing every approval, after a push and without one',
      should: 'fail both rather than end green with CI held',
      actual: [refused(true), refused(false)],
      expected: [false, false],
    });
  });

  test('a CI run that has finished', () => {
    assert({
      given: 'a completed CI run at the head',
      should: 'stop at once without approving anything',
      actual: approveRun(openPull(), [prRun(11, 'completed', 'success')]),
      expected: { ok: true, approved: [], listings: 1 },
    });
  });

  test('a held run from another event', () => {
    assert({
      given: 'a held run at the head from a non pull_request event',
      should: 'not approve it',
      actual: runApprove(
        openPull(),
        [{ ...held(11), event: 'push' }],
        undefined,
        false,
      ),
      expected: { ok: true, approved: [] },
    });
  });

  test('a branch with no pull request', () => {
    assert({
      given: 'a head on a branch with no open pull request',
      should: 'finish without approving anything',
      actual: runApprove([], []),
      expected: { ok: true, approved: [] },
    });
  });

  test('a pushed head whose CI never appears', () => {
    assert({
      given: 'a pushed head on a pull request with no CI run, as in a conflict',
      should: 'fail rather than report the checks as started',
      actual: runApprove(openPull(), []).ok,
      expected: false,
    });
  });

  test('an unpushed head past the listing', () => {
    assert({
      given: 'nothing committed and no CI run at the head in the recent runs',
      should: 'finish, since nothing new was pushed for CI to run on',
      actual: runApprove(openPull(), [], undefined, false),
      expected: { ok: true, approved: [] },
    });
  });

  test('a held run at an unpushed head', () => {
    assert({
      given: 'nothing committed and CI held, as after a cancelled dispatch',
      should: 'approve the stranded run',
      actual: runApprove(openPull(), [held(11)], undefined, false),
      expected: { ok: true, approved: ['11'] },
    });
  });

  test('transient API failures', () => {
    const runs = [held(11)];
    assert({
      given: 'one failed pull request lookup, run listing or approval',
      should: 'retry and approve the held run',
      actual: [
        runApprove(openPull(), runs, 'pulls'),
        runApprove(openPull(), runs, 'runs'),
        runApprove(openPull(), runs, 'approve'),
      ],
      expected: [
        { ok: true, approved: ['11'] },
        { ok: true, approved: ['11'] },
        { ok: true, approved: ['11', '11'] },
      ],
    });
  });
});
