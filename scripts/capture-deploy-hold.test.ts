import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  HOLD_BUDGET_MS,
  holdStep,
  parseLiveCount,
  runHold,
} from './capture-deploy-hold';

setupRitewayBun();

const start = { elapsedMs: 0, failedChecks: 0 };
test('the hold waits only for live capture, and only for its budget', () => {
  assert({
    given: 'no capture, live capture, and live capture past the budget',
    should: 'deploy, wait, and deploy with its reason',
    actual: [
      holdStep(start, 0),
      holdStep(start, 2),
      holdStep({ ...start, elapsedMs: HOLD_BUDGET_MS }, 2),
    ],
    expected: [
      { kind: 'deploy', reason: 'idle' },
      { kind: 'wait' },
      { kind: 'deploy', reason: 'budget' },
    ],
  });
});

test('a failing check never blocks the deploy', () => {
  assert({
    given: 'a first failure, then a third in a row',
    should: 'try again, then deploy without it',
    actual: [
      holdStep(start, null),
      holdStep({ ...start, failedChecks: 2 }, null),
    ],
    expected: [{ kind: 'wait' }, { kind: 'deploy', reason: 'check-failed' }],
  });
});

test('only a bare count is a reading', () => {
  assert({
    given: 'a count after a banner, junk and nothing',
    should: 'read the count and refuse the rest',
    actual: [
      parseLiveCount('Connecting\n3\n'),
      parseLiveCount('error: 3 things'),
      parseLiveCount(''),
    ],
    expected: [3, null, null],
  });
});

const scripted = (readings: readonly (number | null | Error)[]) => {
  let now = 0;
  const rest = [...readings];
  const reports: string[] = [];
  const running = runHold({
    check: async () => {
      const next = rest.shift();
      if (next === undefined) return 1;
      if (next instanceof Error) throw next;
      return next;
    },
    nowMs: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    report: (line) => reports.push(line),
  });
  return { running, reports, left: () => rest.length };
};

test('the hold ends however its readings go', async () => {
  const cleared = scripted([2, 1, 0]);
  const broken = scripted([new Error('ssh'), null, new Error('ssh')]);
  const recovered = scripted([null, null, 1, null, null, 0]);
  const forever = scripted([]);
  assert({
    given:
      'capture ending, a broken check, a check recovering and endless capture',
    should: 'end each with its reason, resetting failures on a good reading',
    actual: [
      await cleared.running,
      await broken.running,
      await recovered.running,
      await forever.running,
    ],
    expected: ['idle', 'check-failed', 'idle', 'budget'],
  });
  assert({
    given: 'the report',
    should: 'carry a reason, a time and a count, nothing about any Round',
    actual: Object.keys(JSON.parse(cleared.reports[0]!)),
    expected: ['reason', 'elapsedMs', 'live'],
  });
});
