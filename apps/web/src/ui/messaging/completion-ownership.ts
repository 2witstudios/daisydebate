type Command =
  | {
      readonly status: 'draft' | 'spent';
      readonly id: string;
      readonly restoreFocus: boolean;
    }
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
  /**
   * Fresh commands adopted in this mounted lifetime. Every server render starts
   * at 0, so a native POST finds its form again despite each render's new ID.
   */
  readonly generation: number;
  readonly offeredId: string;
  /** Used IDs stay spent for this mounted conversation lifetime. */
  readonly spentIds: readonly string[];
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
  command: { id: requestId, status: 'draft', restoreFocus: false },
  generation: 0,
  offeredId: requestId,
  spentIds: [],
});

function nextCommand(state: CompletionOwnership): CompletionOwnership {
  return state.command.status === 'spent' &&
    !state.spentIds.includes(state.offeredId)
    ? {
        ...state,
        command: {
          id: state.offeredId,
          status: 'draft',
          restoreFocus: state.command.restoreFocus,
        },
        generation: state.generation + 1,
      }
    : state;
}

function beginCommand(state: CompletionOwnership): CompletionOwnership {
  return state.command.status === 'spent'
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
  if (state.command.status !== 'pending' && state.command.restoreFocus)
    return { ...state, command: { ...state.command, restoreFocus: false } };
  return state.command.status === 'pending' &&
    state.command.navigation === 'owned'
    ? { ...state, command: { ...state.command, navigation: 'superseded' } }
    : state;
}

function offerCommand(
  state: CompletionOwnership,
  requestId: string,
): CompletionOwnership {
  return state.offeredId === requestId || state.spentIds.includes(requestId)
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
  // A form gone before its answer has an unknown outcome and no draft left to retry:
  // its ID must never carry different text.
  const spent = event.type !== 'failed';
  return {
    state: nextCommand({
      ...state,
      command: {
        id: state.command.id,
        status: spent ? 'spent' : 'draft',
        restoreFocus:
          event.type === 'complete' && state.command.navigation === 'owned',
      },
      spentIds: spent ? [...state.spentIds, state.command.id] : state.spentIds,
    }),
    apply: event.type === 'complete' && state.command.navigation === 'owned',
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
