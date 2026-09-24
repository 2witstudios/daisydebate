'use client';

import { useEffect, useReducer } from 'react';
import { authClient } from '../../../lib/auth-client';
import { SavePasskey } from '../save-passkey/save-passkey';
import {
  createPasskeyEnrollment,
  enrollSafely,
  type PasskeyEnrollmentSeam,
} from './passkey-enrollment';
import {
  initialPasskeyOffer,
  passkeyOfferReducer,
} from './passkey-offer-state';

const supportsPasskeys = () =>
  typeof window !== 'undefined' &&
  typeof window.PublicKeyCredential === 'function';
const enrollOverAuthClient: PasskeyEnrollmentSeam = createPasskeyEnrollment({
  client: authClient,
  supportsPasskeys,
});

/**
 * The passkey offer right after a claimed username. `destination` was
 * validated by the server page. Declining is a plain link there, so it works
 * without JavaScript; a saved passkey leaves by a full navigation so the next
 * render sees the finished account.
 */
export function PasskeyOffer({
  username,
  destination,
  passkeys = enrollOverAuthClient,
}: {
  readonly username: string;
  readonly destination: string;
  readonly passkeys?: PasskeyEnrollmentSeam;
}) {
  const [state, dispatch] = useReducer(
    passkeyOfferReducer,
    initialPasskeyOffer,
  );
  useEffect(() => {
    if (state.step === 'done') window.location.assign(destination);
  }, [state.step, destination]);

  if (state.step === 'done') return null;
  return (
    <SavePasskey
      username={username}
      pending={state.saving}
      notice={state.notice}
      continueHref={destination}
      savePasskey={() => {
        if (state.saving) return;
        dispatch({ type: 'enroll-started' });
        void enrollSafely(passkeys).then((outcome) =>
          dispatch({ type: 'enroll-settled', outcome }),
        );
      }}
    />
  );
}
