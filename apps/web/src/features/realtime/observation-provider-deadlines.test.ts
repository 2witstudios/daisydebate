import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createObservationProvider } from './observation-provider';
import type { ObservationServerMessage } from '@daisy/protocol';
import {
  readyFrame,
  snapshotFrame,
  testDescriptor,
  testTimers,
} from './observation.test-support';
setupRitewayBun();
type State = { status: 'closed'; generation: number; terminal: null };
/** One provider over a scripted connection: frames in, transport state in. */
function providerFixture(now: () => number = () => 0) {
  let stateChange!: (state: State) => void;
  let incoming!: (frame: ObservationServerMessage) => void;
  const provider = createObservationProvider({
    connection: {
      connect: () => {},
      dispose: () => {},
      subscribe: (listener) => {
        stateChange = listener;
        return () => {};
      },
      observe: (_descriptor, listener) => {
        incoming = listener;
        return () => {};
      },
    },
    scheduler: testTimers(now).scheduler,
  });
  const reader = provider.observe(testDescriptor);
  return {
    provider,
    reader,
    incoming: (frame: ObservationServerMessage) => incoming(frame),
    stateChange: (state: State) => stateChange(state),
  };
}
test('logout transport loss fences a late snapshot immediately', () => {
  const { provider, reader, incoming, stateChange } = providerFixture();
  incoming(readyFrame());
  incoming(snapshotFrame({ body: 'private' }));
  stateChange({ status: 'closed', generation: 1, terminal: null });
  incoming(snapshotFrame({ contentRevision: 999, body: 'late' }));
  assert({
    given: 'logout/closed transport while content and permission timer remain',
    should: 'hide immediately and refuse delayed larger-version results',
    actual: reader.read().content,
    expected: null,
  });
  provider.dispose();
});

test('reading after elapsed permission hides despite a delayed timer', () => {
  let now = 0;
  const { provider, reader, incoming } = providerFixture(() => now);
  incoming(readyFrame({ validForMs: 100 }));
  incoming(snapshotFrame({ body: 'private' }));
  now = 101;
  const release = reader.subscribe(() => reader.read());
  assert({
    given: 'the clock passes expiry before the scheduled timer executes',
    should: 'synchronously hide on read, independent of timer timing',
    actual: reader.read().content,
    expected: null,
  });
  incoming(readyFrame({ generation: 2, validForMs: 100 }));
  incoming(snapshotFrame({ generation: 2, body: 'private' }));
  assert({
    given:
      'a synchronous snapshot reader reenters during fresh authorization after expiry',
    should:
      'restore unchanged content under the fresh deadline without invalidating its attempt',
    actual: reader.read().content,
    expected: 'private',
  });
  release();
  provider.dispose();
});

test('an omitted overlay keeps the generation’s last one; a new generation starts without', () => {
  const { provider, reader, incoming } = providerFixture();
  const overlay = {
    ownReactions: [{ messageId: 'e'.repeat(24), reaction: 'up' }],
  };
  incoming(readyFrame({ overlay }));
  incoming(snapshotFrame({ body: 'private' }));
  const shown = reader.read().overlay;
  const { overlay: _omitted, ...renewal } = readyFrame();
  void _omitted;
  incoming(renewal);
  const unchanged = reader.read().overlay;
  incoming({ ...renewal, generation: 2 });
  const replaced = reader.read().overlay;
  assert({
    given:
      'a ready overlay, a same-generation renewal without one, then a new generation without one',
    should: 'keep the overlay through renewal and drop it with the generation',
    actual: { shown, unchanged, replaced },
    expected: { shown: overlay, unchanged: overlay, replaced: undefined },
  });
  provider.dispose();
});
