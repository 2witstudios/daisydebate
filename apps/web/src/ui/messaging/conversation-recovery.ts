export type ConversationRecoveryOrigin = 'page-read' | 'action-render';

type Recovery =
  | { readonly kind: 'new' }
  | { readonly kind: 'stopped' }
  | {
      readonly kind: 'waiting';
      readonly attempts: number;
      readonly answers: readonly string[];
    }
  | {
      readonly kind: 'refreshing';
      readonly attempts: number;
      readonly answers: readonly string[];
      readonly deferred: {
        readonly answer: string;
        readonly retryAfterMs: number;
      } | null;
    };
type Event =
  | {
      readonly kind: 'refused';
      readonly origin: ConversationRecoveryOrigin;
      readonly answer: string;
      readonly retryAfterMs: number;
    }
  | { readonly kind: 'elapsed'; readonly answer: string }
  | { readonly kind: 'settled' }
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
          state: {
            ...state,
            kind: 'refreshing',
            attempts: state.attempts + 1,
            deferred: null,
          },
          effect: { kind: 'refresh' },
        }
      : unchanged;
  // An unrelated action render while a refresh is held is buffered, never
  // scheduled: the newest committed render still owns the page, but budget
  // must not dispatch until the held refresh settles. The actual page answer
  // adopts immediately; a stale-discarded hold adopts on settled.
  if (event.kind === 'settled') {
    if (state.kind !== 'refreshing' || state.deferred === null)
      return unchanged;
    const { answer, retryAfterMs } = state.deferred;
    if (state.attempts >= 3)
      return { state: { kind: 'stopped' }, effect: { kind: 'exhausted' } };
    return {
      state: {
        kind: 'waiting',
        attempts: state.attempts,
        answers: [...state.answers, answer],
      },
      effect: {
        kind: 'wait',
        answer,
        waitMs: Math.min(retryAfterMs * 2 ** state.attempts, 10_000),
      },
    };
  }
  if (state.kind === 'waiting') return unchanged;
  if (state.kind === 'refreshing' && event.origin === 'action-render') {
    if (state.answers.includes(event.answer)) return unchanged;
    if (state.deferred?.answer === event.answer) return unchanged;
    return {
      state: {
        ...state,
        deferred: { answer: event.answer, retryAfterMs: event.retryAfterMs },
      },
      effect: { kind: 'none' as const },
    };
  }
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
    settled: () => accept({ kind: 'settled' }),
    refused: (
      answer: string,
      retryAfterMs: number,
      origin: ConversationRecoveryOrigin,
    ) => accept({ kind: 'refused', answer, retryAfterMs, origin }),
  };
}
