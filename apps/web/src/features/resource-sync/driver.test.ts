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
  onConnectionOpen,
}: {
  readonly realtime?: boolean;
  readonly onConnectionOpen?: () => void;
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
    ...(onConnectionOpen ? { onConnectionOpen } : {}),
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
    down.advance(RESOURCE_POLL_MS.alone);
    down.answer(new Error('network down'));
    await down.flush();
    down.advance(RESOURCE_POLL_MS.alone);
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
    tab.advance(RESOURCE_POLL_MS.alone);
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
    timed.connectionState({ status: 'open', generation: 1, terminal: null });
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

  test('a deadline fires once, so a failed read at it is paced, not looped', async () => {
    const timed = harness({ deadline: (state) => state.readAt + 12000 });
    timed.connectionState({ status: 'open', generation: 1, terminal: null });
    timed.advance(12000);
    timed.answer({ kind: 'unavailable' });
    await timed.flush();
    timed.advance(1);
    const afterFailure = timed.reads();
    timed.advance(RESOURCE_POLL_MS.alone);
    assert({
      given: 'a deadline whose read fails, with the held value still past it',
      should: 'not read again until the stale backstop, then read once',
      actual: [afterFailure, timed.reads()],
      expected: [1, 2],
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
    polled.advance(RESOURCE_POLL_MS.alone);
    polled.answer({ kind: 'found', value: doc(6) });
    await polled.flush();
    assert({
      given: 'no realtime endpoint and one backstop interval',
      should: 'read on the fast backstop and adopt the answer',
      actual: [polled.log, polled.held().value.version],
      expected: [['read'], 6],
    });
  });

  test('the backstop slows only while a doorbell can ring', async () => {
    const paced = harness();
    paced.advance(RESOURCE_POLL_MS.alone);
    const beforeOpen = paced.reads();
    paced.answer({ kind: 'found', value: doc(3) });
    await paced.flush();
    paced.connectionState({ status: 'open', generation: 1, terminal: null });
    paced.advance(RESOURCE_POLL_MS.alone);
    const whileOpen = paced.reads();
    paced.advance(RESOURCE_POLL_MS.doorbell - RESOURCE_POLL_MS.alone);
    const afterSlowInterval = paced.reads();
    paced.answer({ kind: 'found', value: doc(3) });
    await paced.flush();
    paced.connectionState({ status: 'closed', generation: 1, terminal: null });
    paced.advance(RESOURCE_POLL_MS.alone);
    assert({
      given: 'a connection not yet open, then open, then dropped',
      should:
        'poll fast before it opens, slow while it is open, and fast again once it drops',
      actual: [beforeOpen, whileOpen, afterSlowInterval, paced.reads()],
      expected: [1, 1, 2, 3],
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
        'dispose the connection, release listeners and timers, and keep the old value',
      actual: {
        log: gone.log.slice(3),
        timers: gone.timers(),
        version: gone.held().value.version,
      },
      expected: {
        log: ['unsubscribe', 'dispose', 'visibility released'],
        timers: [],
        version: 3,
      },
    });
  });
});

test('one existing socket notifies attendance once per actual open generation', () => {
  let opens = 0;
  const socket = harness({
    onConnectionOpen: () => {
      opens += 1;
    },
  });
  socket.connectionState({ status: 'open', generation: 1, terminal: null });
  socket.connectionState({ status: 'open', generation: 1, terminal: null });
  socket.connectionState({ status: 'closed', generation: 1, terminal: null });
  socket.connectionState({ status: 'open', generation: 2, terminal: null });
  assert({
    given: 'initial open, repeated state, disconnect and real reconnect',
    should: 'notify twice through the existing connection',
    actual: opens,
    expected: 2,
  });
  socket.driver.dispose();
});
