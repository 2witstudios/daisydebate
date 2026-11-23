import { virtualClock } from '@daisy/clock/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { pollWork } from './poll';
import { stopAll } from './shutdown';

setupRitewayBun();

test('every worker stops at once, and a stuck one cannot hold shutdown past its bound', async () => {
  const clock = virtualClock();
  const started = (pass: (signal: AbortSignal) => Promise<'idle'>) =>
    pollWork({
      waits: clock,
      backoff: { busyMs: 100, idleMaxMs: 800 },
      pass,
      failed: () => undefined,
    });
  const idle = [started(async () => 'idle'), started(async () => 'idle')];
  await clock.advance(250);
  const drained = await stopAll({
    waits: clock,
    workers: idle,
    deadlineMs: 5_000,
  });
  const drainedAt = clock.nowMs();
  const stuck = started(() => new Promise<never>(() => undefined));
  const overdue = stopAll({
    waits: clock,
    workers: [stuck, started(async () => 'idle')],
    deadlineMs: 5_000,
  });
  await clock.advance(5_000);
  assert({
    given: 'idle workers, then a worker whose pass never ends',
    should:
      'drain the idle ones with no time passing, and give up on the stuck one at the bound',
    actual: { drained, drainedAt, overdue: await overdue, at: clock.nowMs() },
    expected: {
      drained: 'drained',
      drainedAt: 250,
      overdue: 'overdue',
      at: 5_250,
    },
  });
});
