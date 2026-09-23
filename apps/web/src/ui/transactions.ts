import type { UiState } from './store/state';
import type { UiStore } from './store/store';
import { shellPlugin } from './plugins/shell-plugin';

/** The shell's transactions, namespace-style: pure functions over UiState. */
export const transactions = {
  ...shellPlugin.transactions,
};

export const dispatch = <A>(
  store: UiStore,
  run: (state: UiState, arg: A) => UiState,
  arg: A,
): void => {
  store.setUiState(run(store.getUiState(), arg));
};
