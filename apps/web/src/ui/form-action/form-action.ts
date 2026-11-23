'use client';

import { useAnswer } from '../edge/use-answer';
import { useActionState } from 'react';

/** A form's server action, as `useActionState` calls it. */
export type FormAction<S> = (state: Awaited<S>, form: FormData) => Promise<S>;

/**
 * `action`, answering `unavailable(form)` when the call itself fails. Once
 * hydrated, a server action is a fetch the page makes; a dropped
 * connection rejects it before the action's own catch ever runs, and a
 * rejection inside `useActionState` replaces the page with the root error
 * screen (ISSUE-94).
 */
export const answerUnavailableOnThrow =
  <S>(
    action: FormAction<S>,
    unavailable: (form: FormData) => S,
  ): FormAction<S> =>
  async (state, form) => {
    try {
      return await action(state, form);
    } catch {
      return unavailable(form);
    }
  };

/**
 * `useActionState` for a form posting to a server action, whose call
 * answers `unavailable(form)` when it fails in transport. The server render
 * keeps the server action itself: React renders the form's pre-hydration
 * POST, and adopts a posted form's answer, only from a server action, which
 * a wrapper is not. The browser only ever calls the wrapper.
 */
export function useFormAction<S>(
  action: FormAction<S>,
  initial: Awaited<S>,
  unavailable: (form: FormData) => S,
  onAnswer?: (answer: Awaited<S>) => void,
) {
  const result = useActionState(
    typeof window === 'undefined'
      ? action
      : answerUnavailableOnThrow(action, unavailable),
    initial,
  );
  useAnswer(result[0], onAnswer);
  return result;
}

export { focusLost, useFocusAfterAnswer } from '../edge/use-focus';
