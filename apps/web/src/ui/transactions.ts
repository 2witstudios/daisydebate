import type { UiState } from './store/state';
import { getUiState, setUiState } from './store/store';
import { shellPlugin } from './plugins/shell-plugin';
import { themePlugin } from './plugins/theme-plugin';

/** The shell's transactions, namespace-style: pure functions over UiState. */
export const transactions = {
  ...themePlugin.transactions,
  ...shellPlugin.transactions,
};

export const dispatch = <A>(
  run: (state: UiState, arg: A) => UiState,
  arg: A,
): void => {
  setUiState(run(getUiState(), arg));
};
