type UiResources = {
  /** How many of the member's friends are online; null until read. */
  readonly friendsOnline: number | null;
};

export type UiState = {
  readonly resources: UiResources;
};

/** Nothing is known until the shell reads it. */
export const createInitialState = (): UiState => ({
  resources: { friendsOnline: null },
});
