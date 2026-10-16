import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { ENVELOPE_VERSION } from '@daisy/protocol';
import {
  createResourceSyncDriver,
  RESOURCE_POLL_MS,
  type ResourceRead,
} from './driver';
import { driverEdges } from './driver.test-support';
import { seedResourceSync, type ResourceSync } from './resource-sync';

import {
  doc as makeDoc,
  docIdentity,
  type Doc,
} from './resource-sync.test-support';

setupRitewayBun();

const identity = docIdentity;
const doc = (version: number, label = 'read') => makeDoc(version, label);

function harness({
  realtime = true,
  deadline,
}: {
  readonly realtime?: boolean;
  readonly deadline?: (state: ResourceSync<Doc>) => number | null;
} = {}) {
  const edges = driverEdges<ResourceRead<Doc>>();
  const driver = createResourceSyncDriver({
    identity,
    seed: seedResourceSync(identity, doc(3, 'seed'), edges.scheduler.now()),
    read: edges.read,
    scheduler: edges.scheduler,
    visibility: edges.visibility,
    connection: realtime ? edges.connection : null,
    doorbell: (connection, signal) => {
      const close = connection.subscribeTopic('doc:d1', (frame) =>
        signal(
          frame.type === 'event' && 'entityVersion' in frame.payload
            ? Number(frame.payload.entityVersion)
            : null,
        ),
      );
      return { authorizedSnapshot: () => edges.log.push('authorized'), close };
    },
    ...(deadline ? { deadline } : {}),
  });
  const bell = (version: number) =>
    edges.emit({
      v: ENVELOPE_VERSION,
      type: 'event',
      topic: 'doc:d1',
      position: '1:1',
      payload: { kind: 'room.changed', entityVersion: version, ids: ['d1'] },
    });
  return { ...edges, driver, bell, held: () => driver.readSnapshot() };
}

describe('resource sync driver', () => {
  test('a doorbell reads the resource once and adopts the answer', async () => {
    const doc4 = harness();
    doc4.bell(4);
    doc4.answer({ kind: 'found', value: doc(4) });
    await doc4.flush();
    assert({
      given: 'a connected resource whose doorbell announces version 4',
      should:
        'connect, read once, adopt version 4 and re-authorize the doorbell',
      actual: {
        log: doc4.log,
        held: doc4.held().value,
        freshness: doc4.held().freshness,
      },
      expected: {
        log: ['subscribe doc:d1', 'connect', 'read', 'authorized'],
        held: doc(4),
        freshness: 'current',
      },
    });
  });

  test('a failed read keeps the value as stale and retries on the stale backstop', async () => {
    const down = harness();
    down.bell(4);
    down.answer({ kind: 'unavailable' });
    await down.flush();
    const stale = down.held();
    down.advance(RESOURCE_POLL_MS.stale);
    down.answer(new Error('network down'));
    await down.flush();
    down.advance(RESOURCE_POLL_MS.stale);
    down.answer({ kind: 'found', value: doc(4) });
    await down.flush();
    assert({
      given: 'an unavailable read, a thrown read, then a read that succeeds',
      should:
        'keep the seed as stale, retry once per stale interval, then become current',
      actual: {
        stale: [stale.freshness, stale.value.label],
        reads: down.reads(),
        settled: [down.held().freshness, down.held().value.version],
      },
      expected: { stale: ['stale', 'seed'], reads: 3, settled: ['current', 4] },
    });
  });

  test('the backstop reads only while the page is visible', async () => {
    const tab = harness();
    tab.hide();
    tab.advance(RESOURCE_POLL_MS.current);
    const hidden = tab.reads();
    tab.show();
    assert({
      given:
        'the backstop interval passing in a hidden tab, then the tab shown',
      should: 'read nothing while hidden and read once when shown',
      actual: [hidden, tab.reads()],
      expected: [0, 1],
    });
  });

  test('the resource is read again at its deadline', async () => {
    const timed = harness({ deadline: (state) => state.readAt + 12000 });
    timed.advance(11999);
    const early = timed.reads();
    timed.advance(1);
    assert({
      given: 'a resource that goes out of date 12 s after its read',
      should: 'read exactly at that moment',
      actual: [early, timed.reads()],
      expected: [0, 1],
    });
  });

  test('an accepted answer is adopted without a read', () => {
    const answered = harness();
    answered.driver.accepted(doc(5, 'accepted'));
    answered.bell(5);
    assert({
      given: 'a command answer at version 5 and then its own doorbell',
      should: 'adopt the answer and skip the doorbell it covers',
      actual: [answered.held().value.label, answered.reads()],
      expected: ['accepted', 0],
    });
  });

  test('a lost or reopened connection looks again', async () => {
    const socket = harness();
    socket.connectionState({ status: 'open', generation: 1, terminal: null });
    const first = socket.reads();
    socket.connectionState({ status: 'open', generation: 2, terminal: null });
    socket.answer({ kind: 'found', value: doc(3) });
    await socket.flush();
    socket.connectionState({
      status: 'closed',
      generation: 2,
      terminal: 'revoked',
    });
    assert({
      given: 'a first open, a reopen and then a terminal close',
      should:
        'read after the reopen and after the close, not after the first open',
      actual: [first, socket.reads()],
      expected: [0, 2],
    });
  });

  test('without realtime the backstop alone keeps the resource current', async () => {
    const polled = harness({ realtime: false });
    polled.advance(RESOURCE_POLL_MS.current);
    polled.answer({ kind: 'found', value: doc(6) });
    await polled.flush();
    assert({
      given: 'no realtime endpoint and one backstop interval',
      should: 'read on the backstop and adopt the answer',
      actual: [polled.log, polled.held().value.version],
      expected: [['read'], 6],
    });
  });

  test('disposing releases everything and ignores a late answer', async () => {
    const gone = harness();
    gone.bell(4);
    gone.driver.dispose();
    gone.answer({ kind: 'found', value: doc(4) });
    await gone.flush();
    assert({
      given: 'a read in flight when the page unmounts',
      should:
        'close the connection, release listeners and timers, and keep the old value',
      actual: {
        log: gone.log.slice(3),
        timers: gone.timers(),
        version: gone.held().value.version,
      },
      expected: {
        log: ['unsubscribe', 'close', 'visibility released'],
        timers: [],
        version: 3,
      },
    });
  });
});
