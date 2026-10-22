import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createCaptureSupervisor } from './supervisor';
setupRitewayBun();

type Scope = { roundId: string; sessionId: string; workerId: string };
const harness = (maxSessions = 2) => {
  let now = 0,
    ids = 0,
    offered: { roundId: string; sessionId: string }[] = [];
  const launched: Scope[] = [],
    stopped: string[] = [],
    limits: number[] = [],
    exits = new Map<string, (code: number) => void>();
  const supervisor = createCaptureSupervisor({
    maxSessions,
    retryMs: { initial: 1000, max: 4000 },
    nowMs: () => now,
    nextWorkerId: () => `worker${++ids}`,
    discover: async (limit) => {
      limits.push(limit);
      return offered;
    },
    launch: (scope) => {
      launched.push(scope);
      return {
        exited: new Promise<number>((resolve) =>
          exits.set(scope.workerId, resolve),
        ),
        stop: () => {
          stopped.push(scope.workerId);
          exits.get(scope.workerId)?.(0);
        },
      };
    },
    failed: () => {},
  });
  return {
    supervisor,
    launched,
    stopped,
    limits,
    offer: (...sessions: string[]) => {
      offered = sessions.map((s) => ({ roundId: `round${s}`, sessionId: s }));
    },
    exit: async (workerId: string, code: number) => {
      exits.get(workerId)?.(code);
      await Bun.sleep(0);
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
};

test('each discovered session gets one capture process up to capacity', async () => {
  const h = harness(2);
  h.offer('a', 'b', 'c');
  await h.supervisor.tick();
  await h.supervisor.tick();
  assert({
    given: 'three sessions needing capture and a capacity of two',
    should:
      'launch one process per session with a fresh worker id, never twice',
    actual: { launched: h.launched, limits: h.limits },
    expected: {
      launched: [
        { roundId: 'rounda', sessionId: 'a', workerId: 'worker1' },
        { roundId: 'roundb', sessionId: 'b', workerId: 'worker2' },
      ],
      limits: [2],
    },
  });
});

test('a session whose process ends is rediscovered and taken over by a new worker', async () => {
  const h = harness(2);
  h.offer('a');
  await h.supervisor.tick();
  await h.exit('worker1', 0);
  await h.supervisor.tick();
  assert({
    given: 'a capture process that exits while its session still needs capture',
    should:
      'relaunch under a fresh worker id so the lease is taken over at a new epoch',
    actual: h.launched.map((s) => s.workerId),
    expected: ['worker1', 'worker2'],
  });
});

test('a failing session backs off exponentially without blocking others', async () => {
  const h = harness(2);
  h.offer('a');
  await h.supervisor.tick();
  await h.exit('worker1', 1);
  await h.supervisor.tick();
  h.advance(999);
  await h.supervisor.tick();
  h.advance(1);
  await h.supervisor.tick();
  await h.exit('worker2', 1);
  h.advance(1999);
  h.offer('a', 'b');
  await h.supervisor.tick();
  h.advance(1);
  await h.supervisor.tick();
  assert({
    given: 'repeated failures for one session and a second healthy session',
    should:
      'retry after 1 s then 2 s while launching the healthy session at once',
    actual: h.launched.map((s) => `${s.sessionId}:${s.workerId}`),
    expected: ['a:worker1', 'a:worker2', 'b:worker3', 'a:worker4'],
  });
});

test('stopping drains every capture process and launches nothing more', async () => {
  const h = harness(2);
  h.offer('a', 'b');
  await h.supervisor.tick();
  await h.supervisor.stop();
  h.offer('c');
  await h.supervisor.tick();
  assert({
    given: 'two running capture processes and a stop',
    should: 'stop both, await their exit and refuse later launches',
    actual: { stopped: h.stopped, launched: h.launched.length },
    expected: { stopped: ['worker1', 'worker2'], launched: 2 },
  });
});

test('a running session rediscovered before its lease lands is not launched twice', async () => {
  const h = harness(3);
  h.offer('a');
  await h.supervisor.tick();
  await h.supervisor.tick();
  assert({
    given:
      'a session still offered while its process has not claimed the lease',
    should: 'keep exactly one capture process for it',
    actual: h.launched.map((s) => s.workerId),
    expected: ['worker1'],
  });
});
