import type { ConnectionStore } from '../realtime/connection-types';

type Shared = {
  readonly store: ConnectionStore;
  holders: number;
  /** Holders per topic, so a late joiner can ask for its own acknowledgment. */
  readonly topics: Map<string, number>;
};

const isOpen = (store: ConnectionStore) => {
  const state = store.getState();
  return state.status === 'open' && state.terminal === null;
};

/**
 * One realtime socket per URL for the whole tab: every resource sync on a
 * page (the live Round and its transcript) shares it, and topics already fan
 * out to many listeners. A holder that joins an open socket behaves as on a
 * fresh one: it is told the socket is open, and a topic another holder
 * already subscribed is subscribed again so this holder gets its own
 * `subscribed` acknowledgment and catch-up. Each holder's close or dispose
 * releases only its share, never another holder's socket; the last holder's
 * close closes it, and its dispose disposes it (the entry is never reused).
 */
export function sharedConnections(create: (url: string) => ConnectionStore) {
  const open = new Map<string, Shared>();
  return (url: string): ConnectionStore => {
    let entry = open.get(url);
    if (!entry) {
      entry = { store: create(url), holders: 0, topics: new Map() };
      open.set(url, entry);
    }
    entry.holders += 1;
    const held = entry;
    let released = false;
    return {
      ...held.store,
      subscribe: (listener) => {
        const stop = held.store.subscribe(listener);
        if (isOpen(held.store)) listener(held.store.getState());
        return stop;
      },
      subscribeTopic: (topic, listener) => {
        const holders = held.topics.get(topic) ?? 0;
        held.topics.set(topic, holders + 1);
        const stop = held.store.subscribeTopic(topic, listener);
        if (holders > 0 && isOpen(held.store))
          held.store.resubscribeTopic(topic);
        let stopped = false;
        return () => {
          if (stopped) return;
          stopped = true;
          const left = (held.topics.get(topic) ?? 1) - 1;
          if (left > 0) held.topics.set(topic, left);
          else held.topics.delete(topic);
          stop();
        };
      },
      close: () => release('close'),
      dispose: () => release('dispose'),
    };
    /** Releases this holder's share only; the last holder ends the socket. */
    function release(end: 'close' | 'dispose') {
      if (released) return;
      released = true;
      held.holders -= 1;
      if (held.holders > 0) return;
      open.delete(url);
      held.store[end]();
    }
  };
}
