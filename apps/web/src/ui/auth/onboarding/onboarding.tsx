'use client';

import { useCallback, useEffect, useReducer, useState } from 'react';
import { SavePasskey } from '../save-passkey/save-passkey';
import { createClaimUsername, type ClaimUsername } from './claim-username';
import {
  enrollmentNotices,
  enrollSafely,
  passkeyEnrollmentNotYetAvailable,
  type PasskeyEnrollmentSeam,
} from './passkey-enrollment';
import { UsernameForm } from './username-form';
import {
  canSubmit,
  initialOnboardingState,
  onboardingReducer,
} from './username-state';

const claimOverFetch: ClaimUsername = (username) =>
  createClaimUsername((input, init) => fetch(input, init))(username);

/**
 * Username onboarding, then the passkey offer. `destination` was validated by
 * the server page; leaving is a full navigation so the next render sees the
 * finished account. The passkey step talks to `passkeys`, the seam AUTH-5.x
 * fills: until then it says nothing was saved.
 */
export function Onboarding({
  destination,
  claim = claimOverFetch,
  passkeys = passkeyEnrollmentNotYetAvailable,
}: {
  readonly destination: string;
  readonly claim?: ClaimUsername;
  readonly passkeys?: PasskeyEnrollmentSeam;
}) {
  const [state, dispatch] = useReducer(
    onboardingReducer,
    initialOnboardingState,
  );
  const [saving, setSaving] = useState(false);
  const [offerNotice, setOfferNotice] = useState<string | undefined>();
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
        submit={() => {
          if (!canSubmit(state)) return;
          dispatch({ type: 'submitted' });
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
      email={state.username}
      pending={saving}
      notice={offerNotice}
      savePasskey={() => {
        setSaving(true);
        void enrollSafely(passkeys).then((outcome) => {
          setSaving(false);
          if (outcome.kind === 'saved') finish();
          else setOfferNotice(enrollmentNotices[outcome.kind]);
        });
      }}
      markShared={finish}
      dismiss={finish}
    />
  );
}
