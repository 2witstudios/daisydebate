import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createRoundIncidentObserver } from './observe';
setupRitewayBun();

const world = (
  observeRoundIncident: () => Promise<{ readonly kind: string }>,
  watch = { roomRetired: true, unreachableSince: null as string | null },
) => {
  const alerts: unknown[] = [];
  const logged: string[] = [];
  let calls = 0;
  const observer = createRoundIncidentObserver({
    store: {
      readRoundIncidentWatch: async () => watch,
      observeRoundIncident: (async () => {
        calls += 1;
        return observeRoundIncident();
      }) as never,
    },
    reporter: {
      capture: (error: unknown) => void alerts.push(error),
    } as never,
    logger: { log: (name: string) => void logged.push(name) } as never,
    nextId: () => 'id',
  });
  return { observer, alerts, logged, calls: () => calls };
};
const evidence = (over = {}) => ({
  roundId: 'round',
  observation: {
    kind: 'room',
    captureListed: false,
    seatsListed: false,
    speakerHeard: null,
  } as const,
  nowMs: 1,
  known: {
    incident: { phase: 'none' } as const,
    status: 'active',
  },
  ...over,
});

test('the operator alert', async () => {
  const opened = world(async () => ({ kind: 'opened' }));
  await opened.observer(evidence());
  const held = world(async () => ({ kind: 'unchanged' }));
  await held.observer(evidence());
  assert({
    given: 'the observation that opened an incident, and one that did not',
    should: 'alert and log only for the one that opened it',
    actual: [
      { alerts: opened.alerts.length, logged: opened.logged },
      { alerts: held.alerts.length, logged: held.logged },
    ],
    expected: [
      { alerts: 1, logged: ['round.incident.opened'] },
      { alerts: 0, logged: [] },
    ],
  });
});

test('what takes no Round lock', async () => {
  const healthy = world(async () => ({ kind: 'unchanged' }), {
    roomRetired: false,
    unreachableSince: null,
  });
  await healthy.observer(
    evidence({
      observation: {
        kind: 'room',
        captureListed: true,
        seatsListed: true,
        speakerHeard: null,
      },
      known: {
        incident: { phase: 'none' },
        status: 'active',
      },
    }),
  );
  const ended = world(async () => ({ kind: 'unchanged' }));
  await ended.observer(
    evidence({
      known: {
        incident: { phase: 'none' },
        status: 'completed',
      },
    }),
  );
  assert({
    given: 'a healthy Round, and a finished one',
    should: 'not take the Round lock',
    actual: [healthy.calls(), ended.calls()],
    expected: [0, 0],
  });
});

test('a fault in the hook stays out of the pass', async () => {
  const fault = new Error('lost');
  const broken = world(async () => {
    throw fault;
  });
  await broken.observer(evidence());
  assert({
    given: 'the incident transaction failing',
    should: 'report it to the tracker and resolve',
    actual: broken.alerts,
    expected: [fault],
  });
});
