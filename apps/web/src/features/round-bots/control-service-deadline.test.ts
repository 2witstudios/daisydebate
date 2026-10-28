import { assert, setupRitewayBun, test } from 'riteway/bun';
import { startBotControlService } from './control-service';
import {
  neverOverdue,
  ownedClaim,
  within,
} from './control-service.test-support';
import { failureLog, manualTimers } from '../../lib/worker-timers.test-support';
setupRitewayBun();

const limits = { maxControllers: 2, scanBatch: 4, scanMs: 500, renewMs: 3000 };
const seat = (id: string, segmentId = 's') => ({
  roundId: id,
  roundParticipantId: id,
  segmentId,
});

test('a stop that overruns its deadline is reported, and the seat is revoked and claimed again (ISSUE-789)', async () => {
  const { failures, failed } = failureLog();
  const log: string[] = [];
  const due = Promise.withResolvers<void>();
  let deadlines = 0;
  const incoming = Promise.withResolvers<void>();
  let segment = 'first';
  const { tasks, timers } = manualTimers();
  const service = startBotControlService({
    store: {
      scanRoundBotWorkers: async () => [seat('seat', segment)],
      claimRoundBotWorker: async (target) => {
        log.push(`claim:${target.segmentId}`);
        return ownedClaim(target);
      },
      revokeRoundBotWorker: async (scope) => {
        log.push(`revoke:${scope.segmentId}`);
      },
      verifyRoundBotWorker: async () => {},
    },
    control: (claim) => ({
      pulse: async () => {
        if (claim.scope.segmentId === 'second') incoming.resolve();
        return [];
      },
      // A native close that never answers, for the outgoing claim only.
      stop: () =>
        claim.scope.segmentId === 'first'
          ? new Promise<void>(() => {})
          : Promise.resolve(),
    }),
    limits,
    timers,
    // Each ending has its own deadline; only the outgoing one trips.
    overdue: () => (deadlines++ === 0 ? due.promise : neverOverdue()),
    failed,
  });
  await service.started;
  segment = 'second';
  await tasks.get(500)!();
  due.resolve();
  await within(incoming.promise, 'The incoming claim');
  await service.stop();
  assert({
    given: 'a rotation whose outgoing stop never settles, past its deadline',
    should:
      'report the overrun, revoke the outgoing lease and claim the incoming segment',
    actual: {
      log,
      stages: failures.map((failure) => (failure as unknown[])[1]),
      message: ((failures[0] as unknown[])?.[0] as Error | undefined)?.message,
    },
    expected: {
      log: ['claim:first', 'revoke:first', 'claim:second', 'revoke:second'],
      stages: ['stop'],
      message: 'Seat stop overran its ending',
    },
  });
});

test('an ending whose receipt pulse overruns blames the pulse, not the stop (ISSUE-789)', async () => {
  const { failures, failed } = failureLog();
  const due = Promise.withResolvers<void>();
  const hung = Promise.withResolvers<void>();
  const incoming = Promise.withResolvers<void>();
  let segment = 'first',
    hang = false,
    deadlines = 0;
  const { tasks, timers } = manualTimers();
  const service = startBotControlService({
    store: {
      scanRoundBotWorkers: async () => [seat('seat', segment)],
      claimRoundBotWorker: async (target) => ownedClaim(target),
      revokeRoundBotWorker: async () => {},
      verifyRoundBotWorker: async () => {},
    },
    control: (claim) => ({
      pulse: async () => {
        if (claim.scope.segmentId === 'second') incoming.resolve();
        else if (hang) await hung.promise;
        return [];
      },
      stop: async () => {},
    }),
    limits,
    timers,
    overdue: () => (deadlines++ === 0 ? due.promise : neverOverdue()),
    failed,
  });
  await service.started;
  hang = true;
  void tasks.get(3000)!();
  segment = 'second';
  await tasks.get(500)!();
  due.resolve();
  await within(incoming.promise, 'The incoming claim');
  await service.stop();
  hung.resolve();
  assert({
    given:
      'an ending whose speaker stopped but whose receipt pulse hangs past the deadline',
    should: 'report the overrun once, as the pulse',
    actual: failures.map((failure) => [
      ((failure as unknown[])[0] as Error).message,
      (failure as unknown[])[1],
    ]),
    expected: [['Seat pulse overran its ending', 'pulse']],
  });
});

test('shutdown waits for a claim chained on an ending (ISSUE-789)', async () => {
  const { failed } = failureLog();
  const log: string[] = [];
  const claiming = Promise.withResolvers<void>();
  const answer = Promise.withResolvers<void>();
  let segment = 'first';
  const { tasks, timers } = manualTimers();
  const service = startBotControlService({
    store: {
      scanRoundBotWorkers: async () => [seat('seat', segment)],
      claimRoundBotWorker: async (target) => {
        if (target.segmentId === 'second') {
          claiming.resolve();
          await answer.promise;
        }
        return ownedClaim(target);
      },
      revokeRoundBotWorker: async (scope) => {
        log.push(`revoke:${scope.segmentId}`);
      },
      verifyRoundBotWorker: async () => {},
    },
    control: () => ({ pulse: async () => [], stop: async () => {} }),
    limits,
    timers,
    overdue: neverOverdue,
    failed,
  });
  await service.started;
  segment = 'second';
  await tasks.get(500)!();
  await within(claiming.promise, 'The chained claim');
  const shutdown = service.stop().then(() => log.push('shutdown'));
  answer.resolve();
  await shutdown;
  assert({
    given:
      'shutdown while the incoming claim chained on an ending is in flight',
    should: 'revoke that claim before shutdown resolves',
    actual: log,
    expected: ['revoke:first', 'revoke:second', 'shutdown'],
  });
});

test('a stop that fails after its overrun is reported once, as the overrun (ISSUE-789)', async () => {
  const { failures, failed } = failureLog();
  const due = Promise.withResolvers<void>();
  const stopping = Promise.withResolvers<void>();
  const fail = Promise.withResolvers<void>();
  const incoming = Promise.withResolvers<void>();
  let segment = 'first',
    deadlines = 0;
  const { tasks, timers } = manualTimers();
  const service = startBotControlService({
    store: {
      scanRoundBotWorkers: async () => [seat('seat', segment)],
      claimRoundBotWorker: async (target) => ownedClaim(target),
      revokeRoundBotWorker: async () => {},
      verifyRoundBotWorker: async () => {},
    },
    control: (claim) => ({
      pulse: async () => {
        if (claim.scope.segmentId === 'second') incoming.resolve();
        return [];
      },
      stop: async () => {
        if (claim.scope.segmentId !== 'first') return;
        stopping.resolve();
        await fail.promise;
        throw new Error('The operation was aborted.');
      },
    }),
    limits,
    timers,
    overdue: () => (deadlines++ === 0 ? due.promise : neverOverdue()),
    failed,
  });
  await service.started;
  segment = 'second';
  await tasks.get(500)!();
  await within(stopping.promise, 'The outgoing stop');
  due.resolve();
  await within(incoming.promise, 'The incoming claim');
  fail.resolve();
  await service.stop();
  assert({
    given: 'a stop that rejects only after its deadline was reported',
    should: 'report the overrun and not the late failure',
    actual: failures.map((failure) => (failure as unknown[])[1]),
    expected: ['stop'],
  });
});

test('claims in flight count against maxControllers, and a failed handoff claim is reported (ISSUE-789)', async () => {
  const { failures, failed } = failureLog();
  const claimed: string[] = [];
  const outage = new Error('pool outage');
  const handing = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let targets = [seat('rotating', 'first')];
  const { tasks, timers } = manualTimers();
  const service = startBotControlService({
    store: {
      scanRoundBotWorkers: async () => targets,
      claimRoundBotWorker: async (target) => {
        if (target.segmentId === 'second') {
          handing.resolve();
          await release.promise;
          throw outage;
        }
        claimed.push(target.roundParticipantId);
        return ownedClaim(target);
      },
      revokeRoundBotWorker: async () => {},
      verifyRoundBotWorker: async () => {},
    },
    control: () => ({ pulse: async () => [], stop: async () => {} }),
    limits: { ...limits, maxControllers: 1 },
    timers,
    overdue: neverOverdue,
    failed,
  });
  await service.started;
  targets = [seat('rotating', 'second'), seat('joining')];
  await tasks.get(500)!();
  await within(handing.promise, 'The handoff claim');
  await tasks.get(500)!();
  release.resolve();
  await service.stop();
  assert({
    given: 'a scan while a handoff claim is still in flight at the cap',
    should: 'claim no extra seat, and report the handoff claim that failed',
    actual: { claimed, failures },
    expected: { claimed: ['rotating'], failures: [[outage, 'claim']] },
  });
});
