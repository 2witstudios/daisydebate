import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createObservationSupervisor } from './observation-supervisor';
setupRitewayBun();
const settle = async () => {
  for (let turn = 0; turn < 10; turn++) await Promise.resolve();
};
test('clock uncertainty replaces the runtime and reports unready until it is live', async () => {
  const events: string[] = [];
  const uncertain: (() => void)[] = [];
  let starts = 0,
    failNext = false;
  const retries: (() => void)[] = [];
  const supervisor = createObservationSupervisor({
    create: (onUncertainty) => {
      const id = uncertain.push(onUncertainty);
      return {
        id,
        start: async () => {
          starts++;
          if (failNext) {
            failNext = false;
            throw new Error('Redis unavailable');
          }
        },
        close: async () => {
          events.push(`close:${id}`);
        },
        connect: () => id,
      };
    },
    unavailable: () => 0,
    onRestart: () => events.push('sockets-closed'),
    retry: (work) => retries.push(work),
  });
  await supervisor.start();
  const initial = { ready: supervisor.ready(), runtime: supervisor.connect() };
  failNext = true;
  uncertain[0]!();
  uncertain[0]!();
  await settle();
  const during = supervisor.ready();
  retries.shift()!();
  await settle();
  assert({
    given:
      'a live runtime, a duplicated uncertainty signal and a replacement that first fails to start',
    should:
      'close the old runtime and sockets once, stay unready until a retried replacement starts, then serve it',
    actual: {
      initial,
      during,
      events,
      starts,
      ready: supervisor.ready(),
      runtime: supervisor.connect(),
    },
    expected: {
      initial: { ready: true, runtime: 1 },
      during: false,
      events: ['close:1', 'sockets-closed', 'close:2'],
      starts: 3,
      ready: true,
      runtime: 3,
    },
  });
  await supervisor.close();
});

test('connections arriving while a replacement is not yet live are answered unavailable', async () => {
  const uncertain: (() => void)[] = [];
  const retries: (() => void)[] = [];
  const supervisor = createObservationSupervisor({
    create: (onUncertainty) => {
      const id = uncertain.push(onUncertainty);
      return {
        start: async () => {
          if (id === 2) throw new Error('Redis unavailable');
        },
        close: async () => {},
        connect: () => `runtime-${id}`,
      };
    },
    unavailable: () => 'unavailable',
    onRestart: () => {},
    retry: (work) => retries.push(work),
  });
  await supervisor.start();
  uncertain[0]!();
  await settle();
  const during = supervisor.connect();
  retries.shift()!();
  await settle();
  assert({
    given: 'a replacement whose first start failed, then a retried start',
    should:
      'hand new sockets an unavailable connection during the gap instead of throwing',
    actual: { during, after: supervisor.connect() },
    expected: { during: 'unavailable', after: 'runtime-3' },
  });
  await supervisor.close();
});

test('sockets admitted during a replacement are cycled once it is live', async () => {
  const uncertain: (() => void)[] = [];
  const restarts: string[] = [];
  let finish!: () => void;
  const supervisor = createObservationSupervisor({
    create: (onUncertainty) => {
      const id = uncertain.push(onUncertainty);
      return {
        start: () =>
          id === 1
            ? Promise.resolve()
            : new Promise<void>((resolve) => {
                finish = resolve;
              }),
        close: async () => {},
        connect: () => `runtime-${id}`,
      };
    },
    unavailable: () => 'unavailable',
    onRestart: () => restarts.push('sockets-closed'),
    retry: () => {},
  });
  await supervisor.start();
  uncertain[0]!();
  await settle();
  const during = supervisor.connect();
  finish();
  await settle();
  assert({
    given: 'a socket connecting while the replacement start is still in flight',
    should:
      'answer it unavailable, then close sockets again once live so it reconnects to the live runtime',
    actual: { during, restarts, after: supervisor.connect() },
    expected: {
      during: 'unavailable',
      restarts: ['sockets-closed', 'sockets-closed'],
      after: 'runtime-2',
    },
  });
  await supervisor.close();
});
