/** Whether the Round's last media answer can still be claimed as current. */
export type MediaAnswer = 'current' | 'checking' | 'stale';

/**
 * Follows supersessions and answers. An answer that never comes, for any
 * reason including an SDK apply that never settles, turns stale at the budget
 * rather than checking for ever. The first supersession since an answer starts
 * the budget, so later ones cannot put it off.
 */
export function createAnswerWatch(input: {
  readonly budgetMs: number;
  readonly at: (ms: number, fire: () => void) => () => void;
  readonly changed: (answer: MediaAnswer) => void;
}) {
  let cancel: (() => void) | null = null;
  const stop = () => {
    cancel?.();
    cancel = null;
  };
  return {
    superseded: () => {
      if (cancel) return;
      input.changed('checking');
      cancel = input.at(input.budgetMs, () => input.changed('stale'));
    },
    received: () => {
      stop();
      input.changed('current');
    },
    stop,
  };
}
