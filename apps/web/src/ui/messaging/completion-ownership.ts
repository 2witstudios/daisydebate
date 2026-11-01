/** Client navigation authority, independent of a send's durable outcome. */
type CompletionOwnership = {
  readonly disposed: boolean;
  readonly sequence: number;
  readonly owner: number | null;
};

type Event =
  | { readonly type: 'dispatch' | 'navigate' | 'dispose' }
  | { readonly type: 'complete'; readonly origin: number };

export const initialCompletionOwnership = (): CompletionOwnership => ({
  disposed: false,
  sequence: 0,
  owner: null,
});

/** Consumes before the caller issues an effect; rejected events preserve state. */
export function completionOwnership(state: CompletionOwnership, event: Event) {
  if (state.disposed) return { state, apply: false };
  switch (event.type) {
    case 'dispatch':
      return {
        state: {
          ...state,
          sequence: state.sequence + 1,
          owner: state.sequence + 1,
        },
        apply: false,
      };
    case 'navigate':
      return {
        state: state.owner === null ? state : { ...state, owner: null },
        apply: false,
      };
    case 'dispose':
      return { state: { ...state, disposed: true, owner: null }, apply: false };
    case 'complete':
      return state.owner === event.origin
        ? { state: { ...state, owner: null }, apply: true }
        : { state, apply: false };
  }
}
