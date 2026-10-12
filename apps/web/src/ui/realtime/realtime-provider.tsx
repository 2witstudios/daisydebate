'use client';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createBrowserConnectionStore } from '../../features/realtime/browser-adapters';
import type { ConnectionStore } from '../../features/realtime/connection-store';
import {
  createObservationProvider,
  type RealtimeDescriptor,
} from '../../features/realtime/observation-provider';
import type { ObservationState } from '../../features/realtime/observation-store';

type Realtime = {
  readonly provider: ReturnType<typeof createObservationProvider>;
  readonly connection: ConnectionStore;
};
type Reader<T> = {
  readonly read: () => ObservationState<T>;
  readonly subscribe: (listener: () => void) => () => void;
};
/** A side-effect-free holder an effect fills and empties; renders read it
 * through the external-store contract instead of effect-driven setState. */
function createSlot<T>() {
  let value: T | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T | null) {
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
type Slot<T> = ReturnType<typeof createSlot<T>>;
const RealtimeContext = createContext<Slot<Realtime> | null>(null);
const scheduler = {
  now: () => performance.now(),
  setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
  clearTimeout: (id: unknown) =>
    clearTimeout(id as ReturnType<typeof setTimeout>),
};
const idle: ObservationState<never> = {
  status: 'pending',
  content: null,
  revision: null,
};
const none = () => null;

/** One socket per tab, owned here: created after mount, disposed on unmount
 * (including StrictMode's rehearsal and logout navigation). It connects only
 * when the first descriptor is observed. */
export function RealtimeProvider({
  socketUrl,
  children,
}: {
  readonly socketUrl: string | null;
  readonly children: ReactNode;
}) {
  const [slot] = useState(createSlot<Realtime>);
  useEffect(() => {
    if (socketUrl === null) return;
    const connection = createBrowserConnectionStore(socketUrl);
    const provider = createObservationProvider({ connection, scheduler });
    slot.set({ provider, connection });
    return () => {
      slot.set(null);
      provider.dispose();
    };
  }, [slot, socketUrl]);
  return (
    <RealtimeContext.Provider value={slot}>{children}</RealtimeContext.Provider>
  );
}
function useTab() {
  const slot = useContext(RealtimeContext);
  return useSyncExternalStore(
    slot?.subscribe ?? noSubscription,
    slot?.get ?? none,
    none,
  );
}
const noSubscription = () => () => {};

export type RealtimeView<T> = ObservationState<T> & {
  /** Content was shown and authority later hid it: never fall back to stale
   * server-rendered content for this view. */
  readonly withdrawn: boolean;
};
/** Caches one view per observed state so the external-store snapshot is stable. */
function createView<T>(reader: Reader<T>) {
  let shown = false,
    last: ObservationState<T> | null = null,
    view: RealtimeView<T> = { ...idle, withdrawn: false };
  return () => {
    const state = reader.read();
    if (state === last) return view;
    last = state;
    shown ||= state.content !== null;
    view = { ...state, withdrawn: shown && state.content === null };
    return view;
  };
}
const idleView: RealtimeView<never> = { ...idle, withdrawn: false };

/** Current replaceable state for one feature descriptor (memoize it: its
 * identity is the subscription). Features never refetch, resubscribe or
 * repair; the provider owns all of it. */
export function useRealtime<T>(
  descriptor: RealtimeDescriptor<T> | null,
): RealtimeView<T> {
  const realtime = useTab();
  const [slot] = useState(createSlot<() => RealtimeView<T>>);
  useEffect(() => {
    if (!realtime || descriptor === null) return;
    const observed = realtime.provider.observe(descriptor);
    const view = createView(observed);
    slot.set(view);
    const release = observed.subscribe(() => slot.set(view));
    return () => {
      release();
      slot.set(null);
      observed.close();
    };
  }, [realtime, descriptor, slot]);
  return useSyncExternalStore(
    slot.subscribe,
    () => slot.get()?.() ?? idleView,
    () => idleView,
  );
}

/** The tab's connection for the isolated ephemeral typing lane. */
export const useRealtimeConnection = () => useTab()?.connection ?? null;
