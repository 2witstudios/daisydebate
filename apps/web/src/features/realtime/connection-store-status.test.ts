import { assert, setupRitewayBun, test } from 'riteway/bun';
import { ENVELOPE_VERSION } from '@daisy/protocol';
import { harness, flush, openAndReady } from './connection-store.test-support';

setupRitewayBun();

test('a connection says where it is on the way up', async () => {
  const h = harness();
  const before = h.store.getState().status;
  h.store.connect();
  const asked = h.store.getState().status;
  h.latestSocket().open();
  const socketOpenTicketPending = h.store.getState().status;
  await flush();
  const helloSent = h.store.getState().status;
  h.latestSocket().message({ v: ENVELOPE_VERSION, type: 'ready' });

  assert({
    given: 'a connect, the socket opening, the ticket arriving, then ready',
    should:
      'say ticketing until hello is sent, handshaking until ready, then open',
    actual: [
      before,
      asked,
      socketOpenTicketPending,
      helloSent,
      h.store.getState().status,
    ],
    expected: ['idle', 'ticketing', 'ticketing', 'handshaking', 'open'],
  });
});

test('a connection waiting to retry says so, apart from one that stopped', async () => {
  const retrying = harness();
  await openAndReady(retrying);
  retrying.latestSocket().remoteClose(1006);

  const stopped = harness();
  await openAndReady(stopped);
  stopped.latestSocket().remoteClose(4002);

  const left = harness();
  await openAndReady(left);
  left.store.close();

  assert({
    given: 'a dropped socket, a revoked session and a logout',
    should:
      'say reconnecting for the first and closed, with why, for the others',
    actual: [
      retrying.store.getState(),
      stopped.store.getState(),
      left.store.getState(),
    ],
    expected: [
      { status: 'reconnecting', generation: 1 },
      { status: 'closed', generation: 1, why: 'revoked' },
      { status: 'closed', generation: 2, why: 'left' },
    ],
  });
});

test('a reaped half-open socket is reconnecting until its retry starts', async () => {
  const h = harness();
  await openAndReady(h);
  const seen: string[] = [];
  h.store.subscribe((state) => seen.push(state.status));
  h.scheduler.advance(120_000);

  assert({
    given: 'an open socket whose pings go unanswered',
    should: 'say reconnecting, then ticketing once the retry starts',
    actual: [seen, h.sockets.length],
    expected: [['reconnecting', 'ticketing'], 2],
  });
});

test('a disposed connection says it was disposed and stays so', () => {
  const h = harness();
  h.store.connect();
  h.store.dispose();
  h.store.close();
  h.store.connect();

  assert({
    given: 'dispose, then a close and a connect',
    should: 'stay closed as disposed',
    actual: h.store.getState(),
    expected: { status: 'closed', generation: 2, why: 'disposed' },
  });
});
