'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { systemClock } from '@daisy/clock';
import { SavePasskey } from '../save-passkey/save-passkey';
import { SignInFlow } from '../sign-in-flow/sign-in-flow';
import type { SignInState } from '../sign-in-state';
import { mockSignInPort } from './mock-sign-in-port';

/** Where a signed-in person lands until return destinations are wired. */
const DESTINATION = '/lobby';

/** The sign-in flow on the mock port. Replace with the live adapter. */
export function MockSignIn({
  initialState,
}: {
  readonly initialState: SignInState;
}) {
  const router = useRouter();
  const onSignedIn = useCallback(() => router.push(DESTINATION), [router]);
  return (
    <SignInFlow
      port={mockSignInPort}
      clock={systemClock}
      onSignedIn={onSignedIn}
      initialState={initialState}
    />
  );
}

/** The passkey offer with every choice simply moving on. */
export function MockSavePasskey({ email }: { readonly email: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const moveOn = () => router.push(DESTINATION);
  return (
    <SavePasskey
      email={email}
      pending={pending}
      savePasskey={() => {
        setPending(true);
        moveOn();
      }}
      markShared={moveOn}
      dismiss={moveOn}
    />
  );
}
