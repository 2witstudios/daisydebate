'use client';

import {
  startTransition,
  useActionState,
  useEffect,
  useReducer,
  useState,
  useSyncExternalStore,
} from 'react';
import type { Clock } from '@daisy/clock';
import {
  initialLinkForm,
  signInStateFrom,
  type LinkFormState,
} from '../request-link';
import {
  offerPasskeyAutofillSafely,
  signInWithPasskeySafely,
  type SignInPort,
} from '../sign-in-port';
import {
  canOfferPasskeyAutofill,
  canRequestLink,
  canResend,
  signInReducer,
  type SignInState,
} from '../sign-in-state';
import { renderSignInFlow } from './sign-in-flow.render';
import { startPasskeyAutofill, type AutofillTimers } from './passkey-autofill';

const subscribeToVisibility = (onChange: () => void) => {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
};

/**
 * Whether this tab is on screen. The server render and hydration report
 * hidden, so a tab opened in the background never arms autofill; a visible
 * one re-renders as visible right after hydration.
 */
const usePageVisible = (): boolean =>
  useSyncExternalStore(
    subscribeToVisibility,
    () => document.visibilityState === 'visible',
    () => false,
  );

const browserTimers: AutofillTimers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** The link request: a server action bound to the validated destination. */
export type RequestLinkAction = (
  state: LinkFormState,
  form: FormData,
) => Promise<LinkFormState>;

export type SignInFlowProps = {
  /** Passkey ceremonies: the Better Auth adapter in the live page. */
  readonly port: SignInPort;
  /**
   * The email form's POST. A submission before hydration or without
   * JavaScript is the same POST, and the page renders its answer.
   */
  readonly requestLink: RequestLinkAction;
  /** Injected so the cooldown is testable and never reads ambient time. */
  readonly clock: Clock;
  /** Must keep the same identity across renders (useCallback). */
  readonly onSignedIn: () => void;
};

/**
 * Ticks once a second while a countdown is showing. It starts from the send
 * time, so the server and the first client render agree.
 */
function useNow(clock: Clock, state: SignInState): string {
  const ticking = state.step === 'check-inbox';
  const [now, setNow] = useState(() => (ticking ? state.sentAt : ''));
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(clock.now()), 1000);
    return () => clearInterval(timer);
  }, [clock, ticking]);
  return now;
}

/**
 * Sign-in container: the reducer holds the state, the server action sends
 * links and the port runs passkey ceremonies. The first render starts from
 * the action's last answer, so a post made without JavaScript renders the
 * step it led to.
 */
export function SignInFlow({
  port,
  requestLink,
  clock,
  onSignedIn,
}: SignInFlowProps) {
  const [answered, postLink] = useActionState(requestLink, initialLinkForm);
  const [state, dispatch] = useReducer(signInReducer, answered, (answer) =>
    signInStateFrom(answer, clock.now()),
  );
  const now = useNow(clock, state);

  // Each answer settles the request in flight, timed by this browser's
  // clock so the resend countdown never depends on the server's. The
  // answer a page was rendered with settles nothing: no request is in
  // flight then.
  useEffect(() => {
    if (answered.outcome === undefined) return;
    dispatch({
      type: 'link-settled',
      outcome: answered.outcome,
      at: clock.now(),
    });
  }, [answered, clock]);

  useEffect(() => {
    if (state.step === 'signed-in') onSignedIn();
  }, [state.step, onSignedIn]);

  // Armed whenever the email step goes idle on screen: the explicit passkey
  // button aborts the pending autofill request, so it is offered again after,
  // and a hidden tab pauses until it is shown.
  const autofillArmed = canOfferPasskeyAutofill(state, usePageVisible());
  useEffect(() => {
    if (!autofillArmed) return;
    return startPasskeyAutofill({
      offer: () => offerPasskeyAutofillSafely(port),
      onSettled: (outcome) => dispatch({ type: 'passkey-autofilled', outcome }),
      timers: browserTimers,
      now: () => Date.parse(clock.now()),
    });
  }, [autofillArmed, port, clock]);

  return renderSignInFlow(state, now, {
    typeEmail: (email) => dispatch({ type: 'email-typed', email }),
    postLink,
    requestLink: () => {
      if (!canRequestLink(state)) return false;
      dispatch({ type: 'link-requested' });
      return true;
    },
    signInWithPasskey: () => {
      if (state.step !== 'enter-email' || state.pending !== 'none') return;
      dispatch({ type: 'passkey-requested' });
      void signInWithPasskeySafely(port).then((outcome) =>
        dispatch({ type: 'passkey-settled', outcome }),
      );
    },
    resend: () => {
      const at = clock.now();
      if (!canResend(state, at) || state.step !== 'check-inbox') return;
      dispatch({ type: 'resend-requested', at });
      const form = new FormData();
      form.set('email', state.email);
      startTransition(() => postLink(form));
    },
    changeEmail: () => dispatch({ type: 'change-email' }),
  });
}
