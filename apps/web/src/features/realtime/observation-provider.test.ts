import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { ServerMessage } from '@daisy/protocol';
import type { ConnectionState, ConnectionStore } from './connection-types';
import {
  createObservationProvider,
  type ObservationDescriptor,
} from './observation-provider';

setupRitewayBun();
const id = 'c'.repeat(24);
const resource = { kind: 'channel-messages', id } as const;
type Body = { readonly revision: number };
const descriptor: ObservationDescriptor<Body> = {
  resource,
  parse: (body) =>
    typeof body === 'object' && body !== null && 'revision' in body
      ? (body as Body)
      : null,
  revisionOf: (body) => body.revision,
};

function harness() {
  let clock = 0;
  const timers: { at: number; callback: () => void; live: boolean }[] = [];
  const sent: string[] = [];
  let receive: (frame: ServerMessage) => void = () => {};
  let state: (s: ConnectionState) => void = () => {};
  let ids = 0;
  let listeners = 0;
  const connection = {
    sendObservation: (frame: { type: string; id: string }) => {
      sent.push(`${frame.type}:${frame.id}`);
      return true;
    },
    onMessage: (listener: (frame: ServerMessage) => void) => {
      receive = listener;
      listeners++;
      return () => {
        listeners--;
      };
    },
    subscribe: (listener: (s: ConnectionState) => void) => {
      state = listener;
      listeners++;
      return () => {
        listeners--;
      };
    },
  } as unknown as ConnectionStore;
  const provider = createObservationProvider({
    connection,
    nextId: () => `r${++ids}`,
    scheduler: {
      now: () => clock,
      setTimeout: (callback, ms) => {
        const timer = { at: clock + ms, callback, live: true };
        timers.push(timer);
        return timer;
      },
      clearTimeout: (timer) => {
        (timer as { live: boolean }).live = false;
      },
    },
  });
  const ready = (requestId: string, generation: number, extra = {}) =>
    receive({
      v: 1,
      type: 'observation.ready',
      id: requestId,
      resource,
      generation,
      partition: 'members',
      disclosureRevision: 1,
      minimumContentRevision: 0,
      validForMs: 4700,
      ...extra,
    } as ServerMessage);
  const snapshot = (revision: number, disclosureRevision = 1) =>
    receive({
      v: 1,
      type: 'observation.snapshot',
      resource,
      partition: 'members',
      disclosureRevision,
      contentRevision: revision,
      body: { revision },
    } as ServerMessage);
  const stateFrame = (requestId: string, generation: number, value: string) =>
    receive({
      v: 1,
      type: 'observation.state',
      id: requestId,
      resource,
      generation,
      state: value,
    } as ServerMessage);
  return {
    provider,
    sent,
    ready,
    snapshot,
    stateFrame,
    open: () => state({ status: 'open', generation: 1, terminal: null }),
    drop: () => state({ status: 'closed', generation: 1, terminal: null }),
    advance: (ms: number) => {
      clock += ms;
      for (const timer of timers)
        if (timer.live && timer.at <= clock) {
          timer.live = false;
          timer.callback();
        }
    },
    listeners: () => listeners,
  };
}

describe('observation provider', () => {
  test('one interest per resource', () => {
    const h = harness();
    const a = h.provider.observe(descriptor, { revision: 3 }, () => {});
    const b = h.provider.observe(descriptor, { revision: 3 }, () => {});
    a.release();
    const afterOne = [...h.sent];
    b.release();
    assert({
      given: 'two components observing one resource, released in turn',
      should: 'observe once and unobserve only when the last one leaves',
      actual: [afterOne, h.sent, h.provider.size()],
      expected: [['observe:r1'], ['observe:r1', 'unobserve:r2'], 0],
    });
  });
  test('monotonic snapshots within the permit base', () => {
    const h = harness();
    const held = h.provider.observe(descriptor, { revision: 3 }, () => {});
    h.snapshot(5);
    const beforeReady = held.view();
    h.ready('r1', 7);
    h.snapshot(2);
    h.snapshot(5);
    h.snapshot(4);
    h.snapshot(9, 2);
    assert({
      given:
        'a snapshot before any permit, then older, newer, regressing and foreign-base snapshots',
      should:
        'keep the server-rendered body until a permit exists and apply only newer snapshots of the permit base',
      actual: [beforeReady, held.view()],
      expected: [
        { status: 'pending', body: { revision: 3 } },
        { status: 'live', body: { revision: 5 } },
      ],
    });
  });
  test('revocation and stale generations', () => {
    const h = harness();
    const held = h.provider.observe(descriptor, null, () => {});
    h.ready('r1', 7);
    h.snapshot(1);
    h.stateFrame('r1', 6, 'revoked');
    const stale = held.view();
    h.stateFrame('r1', 7, 'revoked');
    h.snapshot(2);
    assert({
      given: 'a revocation from an older generation, then the current one, then a snapshot',
      should: 'ignore the stale one, hide content on the current one, and accept nothing after',
      actual: [stale, held.view()],
      expected: [
        { status: 'live', body: { revision: 1 } },
        { status: 'hidden', body: null },
      ],
    });
  });
  test('permit deadline', () => {
    const h = harness();
    const held = h.provider.observe(descriptor, null, () => {});
    h.ready('r1', 1);
    h.snapshot(1);
    h.stateFrame('r1', 1, 'unavailable');
    h.advance(4699);
    const before = held.view();
    h.advance(1);
    assert({
      given: 'renewal unavailable until the permit deadline passes',
      should: 'keep content while the permit is valid, then hide it at its deadline',
      actual: [before, held.view()],
      expected: [
        { status: 'degraded', body: { revision: 1 } },
        { status: 'hidden', body: null },
      ],
    });
  });
  test('reconnect re-observes with fresh request ids', () => {
    const h = harness();
    const held = h.provider.observe(descriptor, null, () => {});
    h.ready('r1', 9);
    h.snapshot(1);
    h.drop();
    const dropped = held.view().status;
    h.open();
    h.ready('r1', 10);
    h.ready('r2', 1);
    h.snapshot(2);
    assert({
      given: 'a dropped socket, a new one, a late answer to the old request and a new node numbering from 1',
      should: 'degrade, re-observe under a new id, ignore the old answer and go live on the new one',
      actual: [dropped, h.sent, held.view()],
      expected: [
        'degraded',
        ['observe:r1', 'observe:r2'],
        { status: 'live', body: { revision: 2 } },
      ],
    });
  });
  test('disposal is final', () => {
    const h = harness();
    let notified = 0;
    h.provider.observe(descriptor, null, () => notified++);
    h.provider.dispose();
    h.provider.dispose();
    h.ready('r1', 1);
    assert({
      given: 'a disposed provider receiving a frame',
      should: 'unobserve once, release every connection listener and notify nobody',
      actual: [h.sent, h.listeners(), notified, h.provider.size()],
      expected: [['observe:r1', 'unobserve:r2'], 0, 0, 0],
    });
  });
});
