import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  recoveryObservation,
  recoveryObservationView,
  initialRecoveryObservation,
} from '../e2e/support/messaging-recovery-observation-state';
import {
  ENVELOPE_VERSION,
  type clientMessageSchema,
  type ServerMessage,
} from '@daisy/protocol';
type ClientMessage = ReturnType<typeof clientMessageSchema.parse>;
setupRitewayBun();
const channelId = 'c'.repeat(24);
const resource = { kind: 'channel-messages' as const, id: channelId };
const observe = {
  v: ENVELOPE_VERSION,
  type: 'observe',
  id: 'request',
  resource,
} as const;
const ready = (extra: object = {}): ServerMessage => ({
  v: ENVELOPE_VERSION,
  type: 'observation.ready',
  id: 'request',
  resource,
  generation: 1,
  partition: 'members',
  disclosureRevision: 2,
  minimumContentRevision: 3,
  validForMs: 4700,
  ...extra,
});
const snapshot = (revision: number, extra: object = {}): ServerMessage => ({
  v: ENVELOPE_VERSION,
  type: 'observation.snapshot',
  resource,
  partition: 'members',
  disclosureRevision: 2,
  contentRevision: revision,
  body: {
    version: 1,
    channelId,
    changeVersion: revision,
    messages: [],
    nextBefore: null,
  },
  ...extra,
});
const world = () => {
  let state = initialRecoveryObservation();
  return {
    sent: (frame: ClientMessage) => {
      state = recoveryObservation(state, { kind: 'sent', frame }, channelId, 0);
    },
    received: (frame: ServerMessage, now = 0) => {
      state = recoveryObservation(
        state,
        { kind: 'received', frame },
        channelId,
        now,
      );
    },
    close: () => {
      state = recoveryObservation(state, { kind: 'closed' }, channelId, 0);
    },
    view: (now = 0) => recoveryObservationView(state, now),
  };
};

test('recovered observation requires this socket request and current ready base', () => {
  const socket = world();
  socket.received(ready());
  socket.sent(observe);
  socket.received(ready({ id: 'another' }));
  const unmatched = socket.view();
  socket.received(ready());
  socket.received(snapshot(7, { disclosureRevision: 1 }));
  const wrongBase = socket.view();
  socket.received(snapshot(7));
  const matched = socket.view();
  socket.received(ready({ generation: 2, disclosureRevision: 3 }));
  socket.received(snapshot(99));
  socket.received(ready({ generation: 1 }));
  assert({
    given:
      'unmatched ready, foreign-base snapshots and a superseding permit generation',
    should:
      'accept only this request/current base and discard the previous revision on replacement',
    actual: [unmatched, wrongBase, matched, socket.view()],
    expected: [
      { ready: false, revision: null },
      { ready: true, revision: null },
      { ready: true, revision: 7 },
      { ready: true, revision: null },
    ],
  });
});

test('expiry, unobserve, denial and socket close cannot reuse old readiness', () => {
  const views: unknown[] = [];
  for (const end of [
    'expiry',
    'unobserve',
    'revoked',
    'denied',
    'closed',
  ] as const) {
    const socket = world();
    socket.sent(observe);
    socket.received(ready());
    socket.received(snapshot(7));
    if (end === 'expiry') views.push(socket.view(4700));
    else {
      if (end === 'unobserve')
        socket.sent({ ...observe, type: 'unobserve', id: 'stop' });
      else if (end === 'closed') socket.close();
      else
        socket.received({
          v: ENVELOPE_VERSION,
          type: 'observation.state',
          id: 'request',
          resource,
          generation: 1,
          state: end,
        });
      socket.received(snapshot(99));
      socket.received(ready());
      views.push(socket.view());
    }
  }
  assert({
    given:
      'a previous live snapshot followed by expiry, withdrawal, denial or final close',
    should: 'provide no eligible old revision to the recovered-page oracle',
    actual: views,
    expected: Array.from({ length: 5 }, () => ({
      ready: false,
      revision: null,
    })),
  });
});

test('a snapshot body must belong to the exact resource and carry the stated revision', () => {
  const socket = world();
  socket.sent(observe);
  socket.received(ready());
  socket.received(snapshot(9, { body: {} }));
  socket.received(snapshot(2));
  socket.received(
    snapshot(8, { resource: { ...resource, id: 'd'.repeat(24) } }),
  );
  assert({
    given: 'malformed, below-floor and foreign-channel snapshots',
    should: 'leave the target without an accepted revision',
    actual: socket.view(),
    expected: { ready: true, revision: null },
  });
});
