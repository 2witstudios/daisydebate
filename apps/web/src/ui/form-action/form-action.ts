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

/** Focus is on nothing a member can use: `<body>`, or a control since disabled or removed. */
const focusLost = () => {
  const active = document.activeElement;
  return (
    active === null ||
    active === document.body ||
    !active.isConnected ||
    active.matches(':disabled')
  );
};

/**
 * Hands keyboard focus to the element `targetId` names once each new
 * answer has settled (ISSUE-107). A form disables its controls while its
 * answer is on the way, and a disabled control drops focus to <body>. The
 * answer the page was rendered with owes no focus. A new answer owes focus
 * until the state it leads to has rendered: while `settled` is false the
 * target is still the pre-answer screen's, which may be about to unmount,
 * so nothing is focused. Once settled, the target takes focus and the debt
 * is paid. With no target, nothing is owed.
 *
 * `onlyWhenLost` is for a form whose neighbours stay usable while its answer
 * is on the way (one row's button among several, inside a dialog). Focus
 * then moves only if it is lost, never away from where the member has since
 * put it. Such a form may also leave the page, when live sync removes its
 * row: before its answer arrives, or after an answer that found focus still
 * on the form's own control (an engine that keeps focus on a control while
 * it is disabled). A debt unpaid at that moment is paid on the way out, on
 * the same condition.
 */
export function useFocusAfterAnswer(
  answered: unknown,
  targetId: string | undefined,
  settled: boolean,
  { onlyWhenLost = false }: { readonly onlyWhenLost?: boolean } = {},
) {
  const seen = useRef(answered);
  const owed = useRef(false);
  /** What unmounting still has to pay: an answer on its way, or one that moved nothing. */
  const owedOnLeaving = useRef(false);
  const pay = useRef<() => boolean>(() => false);
  useEffect(() => {
    if (answered === seen.current) return;
    seen.current = answered;
    owed.current = true;
  }, [answered]);
  useEffect(() => {
    pay.current = () => {
      if (onlyWhenLost && !focusLost()) return false;
      if (targetId !== undefined) document.getElementById(targetId)?.focus();
      return true;
    };
    if (!settled) owedOnLeaving.current = true;
    if (!owed.current || !settled) return;
    owed.current = false;
    owedOnLeaving.current = !pay.current();
  });
  useEffect(
    () => () => {
      if (onlyWhenLost && owedOnLeaving.current) pay.current();
    },
    [onlyWhenLost],
  );
}
