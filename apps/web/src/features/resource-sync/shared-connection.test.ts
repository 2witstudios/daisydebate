import { assert, setupRitewayBun, test } from 'riteway/bun';
import type {
  ConnectionState,
  ConnectionStore,
} from '../realtime/connection-types';
import { sharedConnections } from './shared-connection';

setupRitewayBun();

/** A recording store: its state, closes, topic registrations and resubscribes. */
const fakeStore = (status: ConnectionState['status']) => {
  const record = {
    closed: 0,
    resubscribed: [] as string[],
    topicListeners: new Map<string, Set<() => void>>(),
  };
  const state: ConnectionState = { status, generation: 1, terminal: null };
  const store = {
    getState: () => state,
    subscribe: () => () => undefined,
    subscribeTopic: (topic: string, listener: () => void) => {
      const set = record.topicListeners.get(topic) ?? new Set();
      set.add(listener);
      record.topicListeners.set(topic, set);
      return () => void set.delete(listener);
    },
    resubscribeTopic: (topic: string) => void record.resubscribed.push(topic),
    close: () => void (record.closed += 1),
  } as unknown as ConnectionStore;
  return { store, record };
};

test('resource syncs on one page share one realtime socket per URL', () => {
  const stores = new Map<string, ReturnType<typeof fakeStore>[]>();
  const acquire = sharedConnections((url) => {
    const made = fakeStore('connecting');
    stores.set(url, [...(stores.get(url) ?? []), made]);
    return made.store;
  });
  const room = acquire('wss://rt.example/ws');
  const transcript = acquire('wss://rt.example/ws');
  acquire('wss://other.example/ws');
  transcript.close();
  transcript.close();
  const afterOneRelease = stores.get('wss://rt.example/ws')![0]!.record.closed;
  room.close();
  acquire('wss://rt.example/ws');
  assert({
    given:
      'the live Round and its transcript on one URL, another URL, a repeated release, then a fresh acquire',
    should:
      'open one socket per URL, keep it while any holder remains, close it once with the last holder, leave the other URL open, and reopen on the next acquire',
    actual: {
      sockets: [...stores].map(([url, made]) => [url, made.length]),
      afterOneRelease,
      closes: [...stores].map(([url, made]) => [url, made[0]!.record.closed]),
    },
    expected: {
      sockets: [
        ['wss://rt.example/ws', 2],
        ['wss://other.example/ws', 1],
      ],
      afterOneRelease: 0,
      closes: [
        ['wss://rt.example/ws', 1],
        ['wss://other.example/ws', 0],
      ],
    },
  });
});

test('a sync joining an open shared socket behaves as on a fresh one', () => {
  const made = fakeStore('open');
  const acquire = sharedConnections(() => made.store);
  const round = acquire('wss://rt.example/ws');
  const stopRound = round.subscribeTopic('debate:r1', () => undefined);
  const transcript = acquire('wss://rt.example/ws');
  const states: string[] = [];
  transcript.subscribe((state) => void states.push(state.status));
  const stopTranscript = transcript.subscribeTopic(
    'debate:r1',
    () => undefined,
  );
  const listenersWhileShared =
    made.record.topicListeners.get('debate:r1')!.size;
  stopTranscript();
  assert({
    given:
      'the Round already subscribed to its topic on an open socket, then the transcript joining it and later leaving',
    should:
      'tell the joiner the socket is open, resubscribe once for its own acknowledgment, and keep the Round listening after the joiner leaves',
    actual: {
      states,
      resubscribed: made.record.resubscribed,
      listenersWhileShared,
      listenersAfterLeave: made.record.topicListeners.get('debate:r1')!.size,
    },
    expected: {
      states: ['open'],
      resubscribed: ['debate:r1'],
      listenersWhileShared: 2,
      listenersAfterLeave: 1,
    },
  });
  stopRound();
});
