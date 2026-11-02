import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  readController,
  snapshot,
  transportStub,
} from './media-controller.test-support';
import { mediaFailure } from './media-failure';
import { settle } from './browser-transport.test-support';
setupRitewayBun();

const version = (value: number) =>
  ({ kind: 'view', roundViewVersion: value }) as const;

test('only an authority answer ends a live connection', async () => {
  const results = [];
  for (const answer of [401, 403, 404, 409, 410, 429, 500, 502, 504]) {
    let reads = 0;
    let stops = 0;
    const controller = readController({
      reconcile: async () => {
        if (++reads === 1) return snapshot;
        throw mediaFailure(answer);
      },
      transport: () =>
        transportStub({
          stopTracks: () => {
            stops++;
          },
        }),
    });
    await controller.join();
    await controller.reconcile({ kind: 'wake' });
    results.push([answer, controller.state(), stops]);
    controller.stop();
  }
  assert({
    given: 'each failing status on a live connection',
    should:
      'release only for an answer about authority, and keep tracks otherwise',
    actual: results,
    expected: [
      [401, 'unavailable', 1],
      [403, 'unavailable', 1],
      [404, 'unavailable', 1],
      [409, 'unavailable', 1],
      [410, 'unavailable', 1],
      [429, 'out-of-date', 0],
      [500, 'out-of-date', 0],
      [502, 'out-of-date', 0],
      [504, 'out-of-date', 0],
    ],
  });
});

test('a server reply saying unavailable still ends a live connection', async () => {
  let reads = 0;
  let stops = 0;
  const controller = readController({
    reconcile: async () =>
      ++reads === 1 ? snapshot : { ...snapshot, state: 'unavailable' },
    transport: () =>
      transportStub({
        stopTracks: () => {
          stops++;
        },
      }),
  });
  await controller.join();
  await controller.reconcile({ kind: 'wake' });
  assert({
    given: 'the server answering that this caller is no longer admitted',
    should: 'release the tracks',
    actual: [controller.state(), stops],
    expected: ['unavailable', 1],
  });
});

test('reads that keep being superseded still show out of date at the budget', async () => {
  let nowMs = 0;
  let reads = 0;
  const controller = readController({
    readBudget: { now: () => nowMs, ms: 40_000 },
    reconcile: () =>
      ++reads === 1 ? Promise.resolve(snapshot) : new Promise(() => undefined),
  });
  await controller.join();
  const states = [];
  for (let view = 4; view <= 13; view++) {
    nowMs += 5_000;
    void controller.reconcile(version(view));
    await settle();
    states.push(controller.state());
  }
  assert({
    given: 'a newer view every 5 s, each aborting a read that never answers',
    should: 'stop showing plain Connected once the stall passes the budget',
    actual: [states[7], states[8], states[9]],
    expected: ['live', 'out-of-date', 'out-of-date'],
  });
  controller.stop();
});

test('a local device failure is not overwritten by later reads', async () => {
  const seen: string[] = [];
  let reads = 0;
  const controller = readController({
    reconcile: async () => {
      reads++;
      if (reads === 2) throw mediaFailure(503);
      return snapshot;
    },
    changed: (state) => seen.push(state),
  });
  await controller.join();
  controller.deviceFailed();
  seen.length = 0;
  await controller.reconcile({ kind: 'wake' });
  await controller.reconcile({ kind: 'wake' });
  assert({
    given:
      'a device failure the Round shows, then a stalled and an answered read',
    should: 'emit no state that would hide its Retry',
    actual: [seen, reads],
    expected: [[], 3],
  });
  controller.stop();
});
