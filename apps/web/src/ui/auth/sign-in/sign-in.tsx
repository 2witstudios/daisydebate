'use client';

import { useCallback, useMemo } from 'react';
import { systemClock } from '@daisy/clock';
import { authClient } from '../../../lib/auth-client';
import { createBetterAuthSignInPort } from '../better-auth-sign-in-port';
import { SignInFlow } from '../sign-in-flow/sign-in-flow';

const supportsPasskeys = () =>
  typeof window !== 'undefined' &&
  typeof window.PublicKeyCredential === 'function';

const supportsPasskeyAutofill = async () =>
  supportsPasskeys() &&
  typeof window.PublicKeyCredential.isConditionalMediationAvailable ===
    'function' &&
  (await window.PublicKeyCredential.isConditionalMediationAvailable());

/**
 * The live sign-in: Better Auth over the real /api/auth handler. The
 * destination arrives already validated by the server page; a full
 * navigation follows sign-in so the next server render sees the new cookie.
 */
export function SignIn({ destination }: { readonly destination: string }) {
  const port = useMemo(
    () =>
      createBetterAuthSignInPort({
        client: authClient,
        destination,
        supportsPasskeys,
        supportsPasskeyAutofill,
      }),
    [destination],
  );
  const onSignedIn = useCallback(
    () => window.location.assign(destination),
    [destination],
  );
  return <SignInFlow port={port} clock={systemClock} onSignedIn={onSignedIn} />;
}
