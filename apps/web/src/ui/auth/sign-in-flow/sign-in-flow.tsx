'use client';

import { useEffect, useReducer, useState } from 'react';
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

const browserTimers: AutofillTimers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export type SignInFlowProps = {
  /** Who authenticates: the mock today, the Better Auth adapter later. */
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

  // Armed whenever the email step goes idle: the explicit passkey button
  // aborts the pending autofill request, so it must be offered again after.
  const autofillArmed = canOfferPasskeyAutofill(state);
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
