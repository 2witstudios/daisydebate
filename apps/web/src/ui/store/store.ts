'use client';

import { useSyncExternalStore } from 'react';
import { createInitialState, type UiState } from './state';

/**
 * Eval-free UI shell store (ADR 0024): immutable snapshots, pure
 * transactions, and the platform external-store contract. SSR renders the
 * full snapshot through getServerSnapshot.
 */
let state: UiState = createInitialState();

const listeners = new Set<() => void>();

export const getUiState = (): UiState => state;

export const subscribeUiState = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The only mutation path: swap in the next immutable snapshot. */
export const setUiState = (next: UiState): void => {
  if (next === state) return;
  state = next;
  for (const listener of listeners) listener();
};

export const useUiState = <T>(selector: (state: UiState) => T): T =>
  useSyncExternalStore(
    subscribeUiState,
    () => selector(state),
    () => selector(state),
  );
