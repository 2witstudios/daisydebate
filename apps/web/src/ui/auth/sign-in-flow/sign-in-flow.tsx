'use client';

import { useEffect, useReducer, useState, useSyncExternalStore } from 'react';
import type { Clock } from '@daisy/clock';
import {
  offerPasskeyAutofillSafely,
  requestLinkSafely,
  signInWithPasskeySafely,
  type SignInPort,
} from '../sign-in-port';
import {
  canOfferPasskeyAutofill,
  canRequestLink,
  canResend,
  initialSignInState,
  signInReducer,
  type SignInState,
} from '../sign-in-state';
import { renderSignInFlow } from './sign-in-flow.render';
import { startPasskeyAutofill, type AutofillTimers } from './passkey-autofill';

const subscribeToVisibility = (onChange: () => void) => {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
};

/** Whether this tab is on screen; the server render assumes it is. */
const usePageVisible = (): boolean =>
  useSyncExternalStore(
    subscribeToVisibility,
    () => document.visibilityState === 'visible',
    () => true,
  );

const browserTimers: AutofillTimers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export type SignInFlowProps = {
  /** Who authenticates: the Better Auth adapter in the live page. */
  readonly port: SignInPort;
  /** Injected so the cooldown is testable and never reads ambient time. */
  readonly clock: Clock;
  /** Must keep the same identity across renders (useCallback). */
  readonly onSignedIn: () => void;
  readonly initialState?: SignInState;
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

/** Sign-in container: the reducer holds the state, the port does the work. */
export function SignInFlow({
  port,
  clock,
  onSignedIn,
  initialState = initialSignInState(),
}: SignInFlowProps) {
  const [state, dispatch] = useReducer(signInReducer, initialState);
  const now = useNow(clock, state);

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

  const sendLink = async (email: string) =>
    dispatch({
      type: 'link-settled',
      outcome: await requestLinkSafely(port, email),
      at: clock.now(),
    });

  return renderSignInFlow(state, now, {
    typeEmail: (email) => dispatch({ type: 'email-typed', email }),
    requestLink: () => {
      if (!canRequestLink(state) || state.step !== 'enter-email') return;
      dispatch({ type: 'link-requested' });
      void sendLink(state.email.trim());
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
      void sendLink(state.email);
    },
    changeEmail: () => dispatch({ type: 'change-email' }),
  });
}
