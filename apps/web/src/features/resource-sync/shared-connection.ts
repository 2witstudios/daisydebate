import type { ConnectionStore } from '../realtime/connection-types';

/**
 * One realtime socket per URL for the whole tab: every resource sync on a
 * page (the live Round and its transcript) shares it, and topics already fan
 * out to many listeners. Each holder's close releases its share; the socket
 * closes when the last holder does.
 */
export function sharedConnections(create: (url: string) => ConnectionStore) {
  const open = new Map<
    string,
    { readonly store: ConnectionStore; holders: number }
  >();
  return (url: string): ConnectionStore => {
    let entry = open.get(url);
    if (!entry) {
      entry = { store: create(url), holders: 0 };
      open.set(url, entry);
    }
    entry.holders += 1;
    const held = entry;
    let released = false;
    return {
      ...held.store,
      close: () => {
        if (released) return;
        released = true;
        held.holders -= 1;
        if (held.holders > 0) return;
        open.delete(url);
        held.store.close();
      },
    };
  };
}
