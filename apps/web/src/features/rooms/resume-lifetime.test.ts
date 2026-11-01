import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createResumeLifetime } from './resume-lifetime';

setupRitewayBun();

const world = () => {
  let nowMs = 10_000;
  const entries = new Map<string, string>();
  const ticks = new Set<() => void>();
  const listeners = new Set<() => void>();
  const storage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
    removeItem: (key: string) => {
      entries.delete(key);
    },
  };
  const tab = (tabId: string, changed: (owner: boolean) => void) =>
    createResumeLifetime({
      actorId: 'actor',
      roundId: 'round',
      tabId,
      storage,
      now: () => nowMs,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      schedule: (tick) => {
        ticks.add(tick);
        return () => {
          ticks.delete(tick);
        };
      },
      changed,
    });
  return {
    tab,
    tick: (ms: number) => {
      nowMs += ms;
      [...ticks].forEach((tick) => tick());
    },
    event: () => [...listeners].forEach((listener) => listener()),
  };
};

test('direct route and deferred entry share takeover, stepdown and crash expiry', () => {
  const host = world();
  const first: boolean[] = [],
    second: boolean[] = [];
  const owner = host.tab('first', (value) => first.push(value));
  const deferred = host.tab('second', (value) => second.push(value));
  const initially = [first.at(-1), second.at(-1)];
  deferred.takeOver();
  host.event();
  const afterTakeover = [first.at(-1), second.at(-1)];
  // Simulate a crash: effects disappear without releasing the stored claim.
  deferred.stop(false);
  host.tick(5000);
  const afterCrashWithoutEvents = first.at(-1);
  owner.stop();
  assert({
    given:
      'two direct-route lifetimes, explicit takeover, then a crashed owner with no storage/visibility events',
    should:
      'defer the second media mount, step down old local media on takeover, and wake on bounded expiry',
    actual: [initially, afterTakeover, afterCrashWithoutEvents],
    expected: [[true, false], [false, true], true],
  });
});

test('normal close releases ownership for a deferred tab, without an event', () => {
  const host = world();
  const first = host.tab('first', () => undefined);
  let owns = false;
  const second = host.tab('second', (value) => {
    owns = value;
  });
  first.stop();
  host.tick(2500);
  assert({
    given: 'owner close and no cross-tab event',
    should: 'wake the deferred lifetime on its timer',
    actual: owns,
    expected: true,
  });
  second.stop();
});
