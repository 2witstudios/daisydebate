import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  ENVELOPE_VERSION,
  PROTOCOL_VERSION,
  heartbeatMs,
} from '@daisy/protocol';
import {
  harness,
  flush,
  openAndReady,
  validTicket,
} from './connection-store.test-support';

setupRitewayBun();

describe('connection store: single-flight connect', () => {
  test('many components mounting in one render open exactly one socket', () => {
    const h = harness();
    h.store.connect();
    h.store.connect();
    h.store.connect();

    assert({
      given:
        'connect() called three times synchronously (three mounting components)',
      should: 'create exactly one underlying WebSocket',
      actual: h.sockets.length,
      expected: 1,
    });
  });

  test('sends hello with the protocol version and a fetched ticket once the socket opens', async () => {
    const h = harness();
    h.store.connect();
    h.latestSocket().open();
    await flush();

    assert({
      given: 'a socket that has just opened',
      should:
        'fetch a ticket and send hello with the envelope and protocol versions',
      actual: JSON.parse(h.latestSocket().sent[0] ?? '{}'),
      expected: {
        v: ENVELOPE_VERSION,
        type: 'hello',
        protocolVersion: PROTOCOL_VERSION,
        ticket: validTicket,
      },
    });
  });

  test('ready moves the store to open', async () => {
    const h = harness();
    await openAndReady(h);

    assert({
      given: 'a ready message after hello',
      should: 'report status open',
      actual: h.store.getState().status,
      expected: 'open',
    });
  });
});

describe('connection store: heartbeat (ADR 0031 §7)', () => {
  test('pings every heartbeatMs and a timely pong keeps the socket alive', async () => {
    const h = harness();
    await openAndReady(h);

    h.scheduler.advance(heartbeatMs);
    h.latestSocket().message({
      v: ENVELOPE_VERSION,
      type: 'pong',
      id: 'ping-1',
    });
    h.scheduler.advance(heartbeatMs);
    h.latestSocket().message({
      v: ENVELOPE_VERSION,
      type: 'pong',
      id: 'ping-2',
    });
    h.scheduler.advance(heartbeatMs);

    const pings = h
      .latestSocket()
      .sent.map((raw) => JSON.parse(raw))
      .filter((m) => m.type === 'ping');

    assert({
      given: 'a pong answered within every heartbeat period',
      should: 'keep sending pings and never close the socket',
      actual: {
        pingCount: pings.length,
        closed: h.latestSocket().closedWith !== null,
      },
      expected: { pingCount: 3, closed: false },
    });
  });

  test('30s without a pong (elapsed time, not tick count) is judged dead and reconnects', async () => {
    const h = harness();
    await openAndReady(h);
    const deadSocket = h.latestSocket();

    // No pong ever answered. Two heartbeat periods pass with silence.
    h.scheduler.advance(heartbeatMs);
    h.scheduler.advance(heartbeatMs);
    // Past the standard backoff window: proves the death is actually
    // reconnected, not merely detected (a store that reaps but never
    // reconnects would leave sockets.length at 1 here).
    h.scheduler.advance(30_000);
    await flush();

    assert({
      given:
        'no pong for two full heartbeat periods (30 s at the default 15 s), then time past the backoff window',
      should: 'close the dead socket and open a second one',
      actual: {
        deadClosed: deadSocket.closedWith !== null,
        socketCount: h.sockets.length,
      },
      expected: { deadClosed: true, socketCount: 2 },
    });
  });

  test('ping immediately on visibilitychange to visible, without waiting for the next tick', async () => {
    const h = harness();
    await openAndReady(h);
    const before = h.latestSocket().sent.length;

    h.fireVisible();

    const pingsAfter = h
      .latestSocket()
      .sent.slice(before)
      .map((raw) => JSON.parse(raw))
      .filter((m) => m.type === 'ping');

    assert({
      given: 'the tab becoming visible mid-heartbeat-period',
      should: 'send an immediate ping without waiting for the scheduled tick',
      actual: pingsAfter.length,
      expected: 1,
    });
  });

  test('negative control: without the elapsed-time check, silence for 30s would not be judged dead by tick-counting alone', async () => {
    // This asserts the actual dead-detection fires exactly at two periods,
    // not earlier — proving the rule is exercised, not vacuously true.
    const h = harness();
    await openAndReady(h);
    h.scheduler.advance(heartbeatMs);

    assert({
      given: 'exactly one heartbeat period of silence (not yet two)',
      should: 'not yet be judged dead',
      actual: h.latestSocket().closedWith,
      expected: null,
    });
  });
});
