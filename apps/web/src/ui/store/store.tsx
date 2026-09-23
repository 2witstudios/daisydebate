'use client';

import {
  createContext,
  useContext,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createInitialState, type UiState } from './state';

export type UiStore = {
  readonly getUiState: () => UiState;
  readonly subscribeUiState: (listener: () => void) => () => void;
  readonly setUiState: (next: UiState) => void;
};

/**
 * Eval-free UI shell store (ADR 0024): immutable snapshots, pure
 * transactions, and the platform external-store contract. Each instance
 * closes over its own `state`, so it never leaks across component trees.
 */
export const createUiStore = (initial: UiState): UiStore => {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getUiState: () => state,
    subscribeUiState: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** The only mutation path: swap in the next immutable snapshot. */
    setUiState: (next) => {
      if (next === state) return;
      state = next;
      for (const listener of listeners) listener();
    },
  };
};

const UiStoreContext = createContext<UiStore | null>(null);

export type UiStoreProviderProps = {
  readonly children: ReactNode;
  /** Seed for tests; production renders always start from the mock fixtures. */
  readonly initialState?: UiState;
};

/**
 * Request-scoped store boundary (ADR 0024): one store per provider
 * instance, created lazily on first render. React mounts a fresh component
 * tree for every server request, so this gives every request — and every
 * concurrent request — its own state instead of sharing a module global.
 */
export function UiStoreProvider({
  children,
  initialState,
}: UiStoreProviderProps) {
  const [store] = useState(() =>
    createUiStore(initialState ?? createInitialState()),
  );
  return <UiStoreContext value={store}>{children}</UiStoreContext>;
}

export const useUiStore = (): UiStore => {
  const store = useContext(UiStoreContext);
  if (store === null)
    throw new Error('useUiStore must be used inside UiStoreProvider');
  return store;
};

export const useUiState = <T,>(selector: (state: UiState) => T): T => {
  const store = useUiStore();
  return useSyncExternalStore(
    store.subscribeUiState,
    () => selector(store.getUiState()),
    () => selector(store.getUiState()),
  );
};
