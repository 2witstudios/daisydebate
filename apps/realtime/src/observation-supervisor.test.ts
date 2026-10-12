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
