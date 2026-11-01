type Command =
  | { readonly status: 'draft' | 'committed'; readonly id: string }
  | {
      readonly status: 'pending';
      readonly id: string;
      readonly origin: number;
      readonly navigation: 'owned' | 'superseded';
    };

/** Local command lifecycle and its separate permission to navigate. */
type CompletionOwnership = {
  readonly disposed: boolean;
  readonly sequence: number;
  readonly command: Command;
  readonly offeredId: string;
  /** Used IDs stay spent for this mounted conversation lifetime. */
  readonly committedIds: readonly string[];
};
type Event =
  | { readonly type: 'dispatch' | 'navigate' | 'dispose' }
  | {
      readonly type: 'complete' | 'failed' | 'abandon';
      readonly origin: number;
    }
  | { readonly type: 'rendered'; readonly requestId: string };

export const initialCompletionOwnership = (
  requestId: string,
): CompletionOwnership => ({
  disposed: false,
  sequence: 0,
  command: { id: requestId, status: 'draft' },
  offeredId: requestId,
  committedIds: [],
});

function nextCommand(state: CompletionOwnership): CompletionOwnership {
  return state.command.status === 'committed' &&
    !state.committedIds.includes(state.offeredId)
    ? { ...state, command: { id: state.offeredId, status: 'draft' } }
    : state;
}

function beginCommand(state: CompletionOwnership): CompletionOwnership {
  return state.command.status === 'committed'
    ? state
    : {
        ...state,
        sequence: state.sequence + 1,
        command: {
          status: 'pending',
          id: state.command.id,
          origin: state.sequence + 1,
          navigation: 'owned',
        },
      };
}

function supersedeCommand(state: CompletionOwnership): CompletionOwnership {
  return state.command.status === 'pending' &&
    state.command.navigation === 'owned'
    ? { ...state, command: { ...state.command, navigation: 'superseded' } }
    : state;
}

function offerCommand(
  state: CompletionOwnership,
  requestId: string,
): CompletionOwnership {
  return state.offeredId === requestId || state.committedIds.includes(requestId)
    ? state
    : nextCommand({ ...state, offeredId: requestId });
}

type Outcome = { readonly state: CompletionOwnership; readonly apply: boolean };
function settleCommand(
  state: CompletionOwnership,
  event: Extract<Event, { readonly origin: number }>,
): Outcome {
  if (
    state.command.status !== 'pending' ||
    state.command.origin !== event.origin
  )
    return { state, apply: false };
  const success = event.type === 'complete';
  return {
    state: nextCommand({
      ...state,
      command: {
        id: state.command.id,
        status: success ? 'committed' : 'draft',
      },
      committedIds: success
        ? [...state.committedIds, state.command.id]
        : state.committedIds,
    }),
    apply: success && state.command.navigation === 'owned',
  };
}

/** Consumes before the caller issues effects; older/duplicate events are inert. */
export function completionOwnership(
  state: CompletionOwnership,
  event: Event,
): Outcome {
  if (state.disposed) return { state, apply: false };
  switch (event.type) {
    case 'dispatch':
      return { state: beginCommand(state), apply: false };
    case 'navigate':
      return { state: supersedeCommand(state), apply: false };
    case 'dispose':
      return { state: { ...state, disposed: true }, apply: false };
    case 'rendered':
      return { state: offerCommand(state, event.requestId), apply: false };
    case 'abandon':
    case 'failed':
    case 'complete':
      return settleCommand(state, event);
  }
}
