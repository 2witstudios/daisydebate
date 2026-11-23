'use client';

import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  type RefObject,
} from 'react';

/** Focuses the control after a render that requests it. */
export function useFocusWhen(
  ref: RefObject<HTMLElement | null>,
  condition: boolean,
): void {
  useEffect(() => {
    if (condition) ref.current?.focus();
  }, [condition, ref]);
}

/** Focus is on nothing a member can use: `<body>`, or a control since disabled or removed. */
export const focusLost = () => {
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
 * row: before its answer arrives, or after an answer that moved nothing. An
 * answer moves nothing whenever focus is not lost: the member moved on, or
 * the engine kept focus on the form's own control while it was disabled,
 * and the hook cannot tell the two apart. So the debt of any answer that
 * moved nothing is kept, and paid on the way out if focus is lost then.
 */
export function useFocusAfterAnswer(
  answered: unknown,
  targetId: string | undefined,
  settled: boolean,
  { onlyWhenLost = false }: { readonly onlyWhenLost?: boolean } = {},
) {
  const seen = useRef(answered);
  const owed = useRef(false);
  /** What leaving still has to pay: an answer on its way, or any that moved nothing. */
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

/**
 * Moves focus when `key` changes after the first render, before the browser
 * paints (a layout crossing, a rename that ended). `move` is read at its latest.
 */
export function useFocusOnChange<K>(key: K, move: () => void): void {
  const seen = useRef(key);
  const run = useEffectEvent(move);
  useLayoutEffect(() => {
    if (Object.is(seen.current, key)) return;
    seen.current = key;
    run();
  }, [key]);
}

/**
 * When the element a ref holds leaves the page while it holds focus, focus
 * goes to what `next` picks from it, so the keyboard is never dropped to
 * `<body>`.
 */
export function useFocusOnLeave<T extends HTMLElement>(
  target: RefObject<T | null>,
  next: (leaving: T) => HTMLElement | null | undefined,
): void {
  const pick = useEffectEvent(next);
  useLayoutEffect(() => {
    const element = target.current;
    return () => {
      if (element === null || !element.contains(document.activeElement)) return;
      pick(element)?.focus();
    };
  }, [target]);
}

/**
 * When the owner leaves the page owing focus (`owed` holds true) and, once
 * the page has updated, focus has fallen to `<body>`, focus goes to the
 * element `targetId` names. Checked after the removal has painted, so a
 * control disabled or removed with its owner counts as dropped focus; a
 * change of `targetId` settles the debt owed to the previous target.
 */
export function useFocusAfterLeave(
  targetId: string,
  owed: RefObject<boolean>,
): void {
  useEffect(
    () => () => {
      if (owed.current && document.activeElement === document.body)
        document.getElementById(targetId)?.focus();
    },
    [targetId, owed],
  );
}
