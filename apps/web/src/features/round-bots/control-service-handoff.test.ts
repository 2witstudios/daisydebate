import { assert, setupRitewayBun, test } from 'riteway/bun';
import { startBotControlService } from './control-service';
import { recoverableFailure } from '../../server/recoverable-failure';
import { neverOverdue, ownedClaim, seat } from './control-service.test-support';
import { failureLog, manualTimers } from '../../lib/worker-timers.test-support';
import { within } from '../../lib/deadline.test-support';
setupRitewayBun();

/**
 * A rotation whose incoming claim waits on `answer`, then a scan for
 * another seat while it waits, under a cap of `maxControllers`.
 */
async function scanDuringHandoff(maxControllers: number) {
  const { failed } = failureLog();
  const claimed: string[] = [];
  const claiming = Promise.withResolvers<void>();
  const answer = Promise.withResolvers<void>();
  let targets = [seat('rotating', 'first')];
  const { tasks, timers } = manualTimers();
  const service = startBotControlService({
    store: {
      scanRoundBotWorkers: async () => targets,
      claimRoundBotWorker: async (target) => {
        if (target.segmentId === 'second') {
          claiming.resolve();
          await answer.promise;
        }
        claimed.push(`${target.roundParticipantId}:${target.segmentId}`);
        return ownedClaim(target);
      },
      revokeRoundBotWorker: async () => {},
      verifyRoundBotWorker: async () => {},
    },
    control: () => ({ pulse: async () => [], stop: async () => {} }),
    limits: { maxControllers, scanBatch: 4, scanMs: 500, renewMs: 3000 },
    timers,
    overdue: neverOverdue,
    failed,
  });
  await service.started;
  targets = [seat('rotating', 'second')];
  await tasks.get(500)!();
  await within(claiming.promise, 'The incoming claim');
  targets = [seat('rotating', 'second'), seat('joining')];
  await tasks.get(500)!();
  answer.resolve();
  await service.stop();
  return claimed;
}

test('a rotating seat holds one slot while its incoming claim is in flight (ISSUE-789)', async () => {
  assert({
    given: 'a cap of two, one seat rotating and its incoming claim in flight',
    should: 'still admit another seat: the rotating seat counts once',
    actual: (await scanDuringHandoff(2)).sort(),
    expected: ['joining:s', 'rotating:first', 'rotating:second'],
  });
  assert({
    given: 'a cap of one, the rotating seat’s incoming claim in flight',
    should: 'admit no other seat while that claim holds the slot',
    actual: await scanDuringHandoff(1),
    expected: ['rotating:first', 'rotating:second'],
  });
});

test('a worker sink whose log throws never rejects the service’s promises, and every stage is still reported (ISSUE-789)', async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  const routes: string[] = [];
  process.on('unhandledRejection', onUnhandled);
  try {
    const incoming = Promise.withResolvers<void>();
    let segment = 'first',
      scans = 0;
    const { tasks, timers } = manualTimers();
    const service = startBotControlService({
      store: {
        scanRoundBotWorkers: async () => {
          scans += 1;
          if (scans === 3) throw new Error('scan outage');
          return [seat('rotating', segment)];
        },
        claimRoundBotWorker: async (target) => ownedClaim(target),
        revokeRoundBotWorker: async () => {},
        verifyRoundBotWorker: async () => {},
      },
      control: (claim) => ({
        pulse: async () => {
          if (claim.scope.segmentId === 'second') {
            incoming.resolve();
            throw new Error('receipt write failed');
          }
          return [];
        },
        stop: async () => {
          if (claim.scope.segmentId === 'first')
            throw new Error('The operation was aborted.');
        },
      }),
      limits: { maxControllers: 1, scanBatch: 4, scanMs: 500, renewMs: 3000 },
      timers,
      overdue: neverOverdue,
      // The production sink, with a log transport that always throws.
      failed: recoverableFailure({
        isCapacity: () => false,
        logger: {
          log: () => {
            throw new Error('log transport down');
          },
        },
        reporter: {
          capture: (_error, context) => routes.push(context.route),
        },
        nextId: () => 'r4n6p8r2t4v6x8z1k3b5c7d9',
        event: 'round.control.failed',
        operation: 'round.control',
        message: 'Control receipt work remains recoverable',
      }),
    });
    await service.started;
    segment = 'second';
    await tasks.get(500)!();
    await within(incoming.promise, 'The incoming claim');
    await tasks.get(500)!();
    await service.stop();
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  assert({
    given:
      'a failing stop, pulse and scan reported through a sink whose log throws',
    should:
      'report each stage, rotate the seat, stop the service and leave no rejection unhandled',
    actual: { unhandled, routes: [...new Set(routes)].sort() },
    expected: {
      unhandled: [],
      routes: [
        'round.control.discover',
        'round.control.pulse',
        'round.control.stop',
      ],
    },
  });
});
