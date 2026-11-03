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
    get length() {
      return entries.size;
    },
    key: (index: number) => [...entries.keys()][index] ?? null,
  };
  const tab = (
    tabId: string,
    changed: (owner: boolean) => void,
    successor: { id: string | null } = { id: null },
    departed: () => boolean = () => false,
  ) =>
    createResumeLifetime({
      actorId: 'actor',
      roundId: 'round',
      tabId,
      storage,
      predecessor: {
        read: () => successor.id,
        write: (id) => {
          successor.id = id;
        },
        clear: () => {
          successor.id = null;
        },
      },
      now: () => nowMs,
      departed,
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

test('a waiting tab does not take a Round the member left until they press', () => {
  const host = world();
  let left = false;
  const first = host.tab('first', () => undefined);
  const owned: boolean[] = [];
  const waiting = host.tab(
    'waiting',
    (value) => owned.push(value),
    { id: null },
    () => left,
  );
  left = true;
  first.stop();
  host.tick(2500);
  const afterLeaving = owned.at(-1);
  waiting.takeOver();
  assert({
    given: 'an owner that departed, then a press in the waiting tab',
    should: 'keep waiting past the release and own only after the press',
    actual: [afterLeaving, owned.at(-1)],
    expected: [false, true],
  });
  waiting.stop();
});

test('a departure elsewhere does not unseat the tab holding the Round', () => {
  const host = world();
  const owned: boolean[] = [];
  const holder = host.tab(
    'holder',
    (value) => owned.push(value),
    { id: null },
    () => true,
  );
  const first = host.tab('first', () => undefined);
  first.stop();
  holder.takeOver();
  owned.length = 0;
  host.tick(6000);
  assert({
    given: 'an owner whose heartbeat lapsed while a departure stands',
    should: 'keep the Round with no step-down',
    actual: owned,
    expected: [],
  });
  holder.stop();
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

test('a reloading owner keeps its claim for its own next document, ahead of a deferred tab', () => {
  const host = world();
  const session = { id: null as string | null };
  const before = host.tab('document-1', () => undefined, session);
  let deferredOwns: boolean | null = null;
  const deferred = host.tab('other-tab', (value) => {
    deferredOwns = value;
  });
  before.handOff();
  host.event();
  host.tick(100);
  const whileNavigating = deferredOwns;
  let reloadedOwns: boolean | null = null;
  const reloaded = host.tab(
    'document-2',
    (value) => {
      reloadedOwns = value;
    },
    session,
  );
  host.event();
  assert({
    given: 'an owner reloading while another tab waits',
    should:
      'leave the waiting tab deferred and give the reloaded document the claim',
    actual: {
      whileNavigating,
      reloadedOwns,
      deferredOwns,
      heirCleared: session.id,
    },
    expected: {
      whileNavigating: false,
      reloadedOwns: true,
      deferredOwns: false,
      heirCleared: null,
    },
  });
  reloaded.stop();
  deferred.stop();
});

test('a handed-off tab that never returns frees the claim by expiry', () => {
  const host = world();
  const gone = host.tab('closing', () => undefined, { id: null });
  let owns = false;
  const waiting = host.tab('waiting', (value) => {
    owns = value;
  });
  gone.handOff();
  host.tick(5000);
  assert({
    given: 'an owner document that left and no successor',
    should: 'wake the waiting tab at bounded expiry',
    actual: owns,
    expected: true,
  });
  waiting.stop();
});

test('a stale heir mark never overrides another tab that took over', () => {
  const host = world();
  const session = { id: null as string | null };
  const first = host.tab('document-1', () => undefined, session);
  const other = host.tab('other', () => undefined);
  first.handOff();
  other.takeOver();
  let returned: boolean | null = null;
  const successor = host.tab(
    'document-2',
    (value) => {
      returned = value;
    },
    session,
  );
  assert({
    given: 'a tab that explicitly took over before the old owner returned',
    should: 'keep the explicit takeover',
    actual: returned,
    expected: false,
  });
  successor.stop();
  other.stop();
});
