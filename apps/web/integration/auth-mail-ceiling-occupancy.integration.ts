import { afterAll } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createCeilingFlows, GLOBAL_MINUTE } from './auth-ceiling-helpers';
import {
  createSecondInstances,
  elapse,
  holdOpen,
  recipientBucket,
} from './auth-rate-limit-helpers';
import { CLIENT_IP_HEADER } from '../src/features/auth/client-ip';

/**
 * DEC-41 for the handed-off work (ISSUE-185): whether an address has an
 * account must not change anything another request can observe, including
 * whether that request's own work is shed. The review's canary attack:
 * request the target, then shortly after, the attacker's own existing
 * account (the canary), and read whether the canary is mailed. A real send
 * holds a slot for a provider round trip, so if a dropped sign-up freed its
 * slot sooner, the canary would be shed more often behind an existing
 * target than behind an unknown one.
 *
 * The bound is narrowed to 1 running and 0 waiting on a second auth server
 * over the suite's real PostgreSQL, Redis namespace and ledger, so each
 * trial's outcome depends only on whether the target's work still holds
 * the one slot when the canary's is decided. The provider takes
 * `PROVIDER_ROUND_TRIP_MS` (a slow provider).
 */
requireTestServices(process.env);
setupRitewayBun();

const { accounts, testApp, fresh, magicLink, elapseGlobalMinute, settled } =
  createCeilingFlows();

const PROVIDER_ROUND_TRIP_MS = 400;

/**
 * How far the canary follows the target. At 360 ms (90 % of a round trip)
 * the target's work is still running, so the canary is nearly always shed
 * behind a real send; at 390 ms it is close to freeing its slot, so either
 * outcome is possible. The rates must match at both.
 */
const CANARY_DELAYS_MS = [360, 390];

/** Trials per kind of target in each run, and runs per delay. */
const TRIALS = 12;
const RUNS = 3;

/**
 * Two-sided critical value of the two-proportion z-test at α = 0.001: one
 * run from identical rates exceeds it one time in a thousand, so the six
 * runs together at most six in a thousand. A canary always mailed behind one
 * kind of target and rarely behind the other gives |z| above 4 with 12
 * trials a side.
 */
const Z_CRITICAL = 3.29;

/** The pooled two-proportion z statistic (0 when the pooled rate is 0 or 1). */
const zStatistic = (hitsA: number, hitsB: number, trials: number) => {
  const pooled = (hitsA + hitsB) / (2 * trials);
  const spread = Math.sqrt(pooled * (1 - pooled) * (2 / trials));
  return spread === 0 ? 0 : (hitsA - hitsB) / trials / spread;
};

const { secondInstance, closeExtraInstances } = createSecondInstances(testApp);
const { server, sent: mailed } = secondInstance({
  providerRoundTripMs: PROVIDER_ROUND_TRIP_MS,
  realLedger: true,
  afterResponseLimits: { maxRunning: 1, maxQueued: 0 },
});
afterAll(closeExtraInstances);

const request = (email: string) =>
  server.instance.handler(
    testApp.jsonPost(
      '/api/auth/sign-in/magic-link',
      { email },
      { [CLIENT_IP_HEADER]: testApp.newClient() },
    ),
  );

/** An address's own recipient windows elapsed, so it is always admitted. */
const recipientRoom = (email: string) =>
  elapse(
    testApp,
    ...[60, 3_600, 86_400].map((window) =>
      recipientBucket(testApp, 'magic-link', email, window),
    ),
  );

/** One trial: the target, then the canary; whether the canary was mailed. */
const trial = async (target: string, canary: string, delayMs: number) => {
  await recipientRoom(target);
  await recipientRoom(canary);
  await server.settled();
  const from = mailed.length;
  await request(target);
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  await request(canary);
  await server.settled();
  return mailed.slice(from).includes(canary) ? 1 : 0;
};

describe('ISSUE-185 handed-off work occupies capacity alike for any address (DEC-41)', () => {
  test('a canary behind an existing target is mailed at the same rate as behind an unknown one', async () => {
    await elapseGlobalMinute();
    const existingTarget = (await accounts.signUp()).email;
    const canary = (await accounts.signUp()).email;
    await Promise.all(Array.from({ length: 120 }, () => magicLink(fresh())));
    await settled();
    await holdOpen(testApp, GLOBAL_MINUTE, 600_000);
    // Real round trips measured before the first trial.
    for (let warm = 0; warm < 4; warm += 1) await trial(canary, canary, 0);

    const runs: Array<{
      delayMs: number;
      existing: number;
      unknown: number;
      z: number;
    }> = [];
    for (const delayMs of CANARY_DELAYS_MS)
      for (let run = 0; run < RUNS; run += 1) {
        let existing = 0;
        let unknown = 0;
        for (let index = 0; index < TRIALS; index += 1) {
          const arms = [
            async () =>
              (existing += await trial(existingTarget, canary, delayMs)),
            async () => (unknown += await trial(fresh(), canary, delayMs)),
          ];
          // ABBA order: drift in machine load weighs on both kinds alike.
          for (const arm of index % 2 === 0 ? arms : arms.reverse())
            await arm();
        }
        runs.push({
          delayMs,
          existing,
          unknown,
          z: zStatistic(existing, unknown, TRIALS),
        });
      }

    assert({
      given: `a saturated ceiling, a provider taking ${PROVIDER_ROUND_TRIP_MS} ms, one running slot, and ${RUNS} runs of ${TRIALS} trials a side at each canary delay (delay: canary mailed behind existing/unknown targets, z — ${runs
        .map(
          ({ delayMs, existing, unknown, z }) =>
            `${delayMs} ms: ${existing}/${TRIALS} vs ${unknown}/${TRIALS}, ${z.toFixed(2)}`,
        )
        .join('; ')})`,
      should: `keep every run's two-proportion |z| under ${Z_CRITICAL} (α = 0.001)`,
      actual: runs.every(({ z }) => Math.abs(z) < Z_CRITICAL),
      expected: true,
    });
  }, 600_000);
});
