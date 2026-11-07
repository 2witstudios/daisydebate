import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createUsageRecovery } from './usage-recovery';

setupRitewayBun();

test('abandoned usage recovery pages past failures, revisits a full cycle and bounds each scan', async () => {
  const scans: unknown[] = [],
    released: string[] = [],
    failures: string[] = [];
  const recovery = createUsageRecovery({
    instanceId: 'worker',
    store: {
      readAbandonedUsageCandidates: async (input) => {
        scans.push(input);
        return input.afterId
          ? { candidates: [], afterId: null, exhausted: true }
          : {
              candidates: [
                { roundId: 'blocked', actorId: 'a' },
                { roundId: 'next', actorId: 'b' },
              ],
              afterId: 'next',
              exhausted: false,
            };
      },
      releaseAbandonedUsage: async ({ roundId }, policy) => {
        released.push(roundId);
        if (roundId === 'blocked') throw Error('controlled failure');
        return {
          bindingReleased: policy({
            boundRoundId: roundId,
            roundId,
            abandoned: true,
            bot: { kind: 'released', releasedAt: '2026-11-01T00:00:00.000Z' },
            judge: { kind: 'unselected' },
          }),
        };
      },
    },
    failed: (_error, stage) => {
      failures.push(stage);
    },
  });
  await recovery.run();
  await recovery.run();
  await recovery.run();
  recovery.stop();
  await recovery.run();
  assert({
    given:
      'a persistent first-record failure, a later ready identity and three scheduled pages, followed by stop',
    should:
      'advance through the cycle, retry failures next cycle, bound page size and refuse new work after stop',
    actual: [scans, released, failures],
    expected: [
      [
        { instanceId: 'worker', limit: 25 },
        { instanceId: 'worker', limit: 25, afterId: 'next' },
        { instanceId: 'worker', limit: 25 },
      ],
      ['blocked', 'next', 'blocked', 'next'],
      ['release', 'release'],
    ],
  });
});

test('abandoned usage recovery stops between mutations and retains discovery retries', async () => {
  const seen: string[] = [];
  let failScan = true;
  const recovery = createUsageRecovery({
    instanceId: 'worker',
    store: {
      readAbandonedUsageCandidates: async () => {
        if (failScan) {
          failScan = false;
          throw Error('discovery outage');
        }
        return {
          candidates: [
            { roundId: 'first', actorId: 'a' },
            { roundId: 'later', actorId: 'b' },
          ],
          afterId: 'later',
          exhausted: true,
        };
      },
      releaseAbandonedUsage: async ({ roundId }) => {
        seen.push(roundId);
        recovery.stop();
        return { bindingReleased: true };
      },
    },
    failed: (_error, stage) => {
      seen.push(stage);
    },
  });
  await recovery.run();
  await recovery.run();
  assert({
    given:
      'discovery recovers after an outage and shutdown arrives during the first release',
    should: 'retry discovery and stop before starting the next mutation',
    actual: seen,
    expected: ['discover', 'first'],
  });
});
