type Identity = {
  readonly partition: string;
  readonly disclosureRevision: number;
};
type Incoming = Identity & {
  readonly contentRevision: number;
  readonly body: unknown;
};
export type ObservationState<T> = {
  readonly status:
    'pending' | 'ready' | 'degraded' | 'denied' | 'unavailable' | 'disposed';
  readonly content: T | null;
  readonly revision: number | null;
};
/** Replaceable server content only. Forms/drafts/files live outside this store.
 * Content dirt preserves the last authorized view; authority loss fences every
 * result, regardless of its larger content revision.
 */
export function createObservationStore<T>({
  decode,
}: {
  readonly decode: (value: unknown) => T | null;
}) {
  let generation = 0,
    disposed = false;
  let identity: Identity | null = null;
  let state: ObservationState<T> = {
    status: 'pending',
    content: null,
    revision: null,
  };
  const listeners = new Set<() => void>();
  function update(next: ObservationState<T>) {
    state = next;
    for (const listener of listeners) listener();
  }
  const matches = (snapshot: Identity) =>
    identity !== null &&
    identity.partition === snapshot.partition &&
    identity.disclosureRevision === snapshot.disclosureRevision;
  const advances = (revision: number) =>
    Number.isSafeInteger(revision) &&
    revision >= 0 &&
    (state.revision === null || revision > state.revision);
  function hide(status: ObservationState<T>['status']) {
    generation++;
    identity = null;
    update({ status, content: null, revision: null });
  }
  return {
    begin() {
      return ++generation;
    },
    authorize(attempt: number, authorized: Identity) {
      if (disposed || attempt !== generation) return false;
      if (
        !identity ||
        identity.partition !== authorized.partition ||
        identity.disclosureRevision !== authorized.disclosureRevision
      )
        update({ status: 'pending', content: null, revision: null });
      identity = authorized;
      return true;
    },
    snapshot(attempt: number, snapshot: Incoming) {
      if (disposed || attempt !== generation || !matches(snapshot))
        return false;
      if (!advances(snapshot.contentRevision)) return false;
      const content = decode(snapshot.body);
      if (content === null) return false;
      update({ status: 'ready', content, revision: snapshot.contentRevision });
      return true;
    },
    dirty() {
      if (!disposed && identity) update({ ...state, status: 'degraded' });
    },
    deny() {
      if (!disposed) hide('denied');
    },
    unavailable() {
      if (!disposed) hide('unavailable');
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      hide('disposed');
      listeners.clear();
    },
    read: () => state,
    subscribe(listener: () => void) {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
