'use client';

import { useCallback, useEffect, useReducer } from 'react';
import { authClient } from '../../../lib/auth-client';
import { onboardingHref, signInHref } from '../../../features/access/decision';
import { SavePasskey } from '../save-passkey/save-passkey';
import { createClaimUsername, type ClaimUsername } from './claim-username';
import {
  createPasskeyEnrollment,
  enrollSafely,
  type PasskeyEnrollmentSeam,
} from './passkey-enrollment';
import { UsernameForm } from './username-form';
import {
  awaitsClaim,
  initialOnboardingState,
  onboardingReducer,
} from './username-state';

const claimOverFetch: ClaimUsername = createClaimUsername((url, init) =>
  fetch(url, init),
);
const supportsPasskeys = () =>
  typeof window !== 'undefined' &&
  typeof window.PublicKeyCredential === 'function';
const enrollOverAuthClient: PasskeyEnrollmentSeam = createPasskeyEnrollment({
  client: authClient,
  supportsPasskeys,
});

/**
 * Username onboarding, then the passkey offer. `destination` was validated by
 * the server page; leaving is a full navigation so the next render sees the
 * finished account. The passkey step talks to `passkeys`, the seam AUTH-5.x
 * fills: until then it says nothing was saved.
 */
export function Onboarding({
  destination,
  claim = claimOverFetch,
  passkeys = enrollOverAuthClient,
}: {
  readonly destination: string;
  readonly claim?: ClaimUsername;
  readonly passkeys?: PasskeyEnrollmentSeam;
}) {
  const [state, dispatch] = useReducer(
    onboardingReducer,
    initialOnboardingState,
  );
  const leave = useCallback(
    () => window.location.assign(destination),
    [destination],
  );
  useEffect(() => {
    if (state.step === 'done') leave();
  }, [state.step, leave]);

  if (state.step === 'choose')
    return (
      <UsernameForm
        username={state.username}
        pending={state.pending}
        notice={state.notice}
        typeUsername={(username) => dispatch({ type: 'typed', username })}
        signInHref={signInHref(onboardingHref(destination))}
        submit={() => {
          // The reducer alone decides: a name it refuses, or a repeat while
          // one claim is in flight, never reaches the server.
          const next = onboardingReducer(state, { type: 'submitted' });
          dispatch({ type: 'submitted' });
          if (awaitsClaim(state) || !awaitsClaim(next)) return;
          void claim(state.username).then(
            (outcome) => dispatch({ type: 'claim-settled', outcome }),
            () =>
              dispatch({
                type: 'claim-settled',
                outcome: { kind: 'unavailable' },
              }),
          );
        }}
      />
    );
  if (state.step === 'done') return null;
  const finish = () => dispatch({ type: 'passkey-step-finished' });
  return (
    <SavePasskey
      username={state.username}
      pending={state.saving}
      notice={state.notice}
      savePasskey={() => {
        if (state.saving) return;
        dispatch({ type: 'enroll-started' });
        void enrollSafely(passkeys).then((outcome) =>
          dispatch({ type: 'enroll-settled', outcome }),
        );
      }}
      markShared={finish}
      dismiss={finish}
    />
  );
}
