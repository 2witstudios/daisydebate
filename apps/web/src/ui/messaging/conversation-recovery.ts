type Recovery =
  | { readonly kind: 'new' }
  | { readonly kind: 'stopped' }
  | {
      readonly kind: 'waiting' | 'refreshing';
      readonly attempts: number;
      readonly answers: readonly string[];
    };
type Event =
  | {
      readonly kind: 'refused';
      readonly answer: string;
      readonly retryAfterMs: number;
    }
  | { readonly kind: 'elapsed'; readonly answer: string }
  | { readonly kind: 'stop' };
type Effect =
  | { readonly kind: 'none' | 'refresh' | 'stop' | 'exhausted' }
  | { readonly kind: 'wait'; readonly answer: string; readonly waitMs: number };

export const initialConversationRecovery = (): Recovery => ({ kind: 'new' });

/** Total recovery decisions; timers and the router remain at the edge. */
export function conversationRecovery(
  state: Recovery,
  event: Event,
): {
  readonly state: Recovery;
  readonly effect: Effect;
} {
  const unchanged = { state, effect: { kind: 'none' as const } };
  if (state.kind === 'stopped') return unchanged;
  if (event.kind === 'stop')
    return { state: { kind: 'stopped' }, effect: { kind: 'stop' } };
  if (event.kind === 'elapsed')
    return state.kind === 'waiting' && state.answers.at(-1) === event.answer
      ? {
          state: { ...state, kind: 'refreshing', attempts: state.attempts + 1 },
          effect: { kind: 'refresh' },
        }
      : unchanged;
  if (state.kind === 'waiting') return unchanged;
  if (state.kind === 'refreshing' && state.answers.includes(event.answer))
    return unchanged;
  const attempts = state.kind === 'new' ? 0 : state.attempts;
  if (attempts >= 3)
    return { state: { kind: 'stopped' }, effect: { kind: 'exhausted' } };
  return {
    state: {
      kind: 'waiting',
      attempts,
      answers: [...(state.kind === 'new' ? [] : state.answers), event.answer],
    },
    effect: {
      kind: 'wait',
      answer: event.answer,
      waitMs: Math.min(event.retryAfterMs * 2 ** attempts, 10_000),
    },
  };
}

/** A refused conversation owns at most three sequential fresh page reads. */
export function createConversationRecovery(input: {
  readonly refresh: () => void;
  readonly schedule: (run: () => void, waitMs: number) => () => void;
  readonly exhausted?: () => void;
}) {
  let state = initialConversationRecovery();
  let cancel = () => {};
  const accept = (event: Event) => {
    const result = conversationRecovery(state, event);
    state = result.state;
    const { effect } = result;
    switch (effect.kind) {
      case 'none':
        return;
      case 'refresh':
        input.refresh();
        return;
      case 'stop':
        cancel();
        return;
      case 'exhausted':
        cancel();
        input.exhausted?.();
        return;
      case 'wait':
        cancel = input.schedule(
          () => accept({ kind: 'elapsed', answer: effect.answer }),
          effect.waitMs,
        );
    }
  };
  return {
    stop: () => accept({ kind: 'stop' }),
    refused: (answer: string, retryAfterMs: number) =>
      accept({ kind: 'refused', answer, retryAfterMs }),
  };
}
