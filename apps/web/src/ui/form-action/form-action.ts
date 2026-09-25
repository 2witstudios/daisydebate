'use client';

import { useActionState, useEffect, useRef } from 'react';

/** A form's server action, as `useActionState` calls it. */
export type FormAction<S> = (state: Awaited<S>, form: FormData) => Promise<S>;

/**
 * `action`, answering `unavailable(form)` when the call itself fails. With
 * JavaScript on, a server action is a fetch the page makes; a dropped
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
 * keeps the server action itself: React renders the form's no-JavaScript
 * POST, and adopts a posted form's answer, only from a server action, which
 * a wrapper is not. The browser only ever calls the wrapper.
 */
export function useFormAction<S>(
  action: FormAction<S>,
  initial: Awaited<S>,
  unavailable: (form: FormData) => S,
) {
  return useActionState(
    typeof window === 'undefined'
      ? action
      : answerUnavailableOnThrow(action, unavailable),
    initial,
  );
}

/**
 * Hands keyboard focus to the element `targetId` names once each new
 * answer has rendered (ISSUE-107). A form disables its controls while its
 * answer is on the way, and a disabled control drops focus to <body>. The
 * answer the page was rendered with owes no focus. Focus is owed until an
 * enabled target takes it: an answer that leads to another step, such as
 * the sign-in link's inbox step, renders it one commit later. With no
 * target, nothing is owed.
 */
export function useFocusAfterAnswer(
  answered: unknown,
  targetId: string | undefined,
) {
  const seen = useRef(answered);
  const owed = useRef(false);
  useEffect(() => {
    if (answered === seen.current) return;
    seen.current = answered;
    owed.current = true;
  }, [answered]);
  useEffect(() => {
    if (!owed.current) return;
    const target =
      targetId === undefined ? null : document.getElementById(targetId);
    target?.focus();
    if (target === null || document.activeElement === target)
      owed.current = false;
  });
}
