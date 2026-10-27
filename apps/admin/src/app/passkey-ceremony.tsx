'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  completeEnrollment,
  completeSignIn,
  startEnrollment,
  startSignIn,
} from './actions';

/**
 * The admin app's only client script: it runs the WebAuthn ceremony the
 * browser alone can perform, between two server actions. The enrollment
 * token is read from the URL fragment, which no server ever logs.
 */
type Status = 'idle' | 'working' | 'failed';

const fragmentToken = () => window.location.hash.slice(1);

async function enroll(): Promise<boolean> {
  const token = fragmentToken();
  const started = await startEnrollment(token);
  if (!started.ok) return false;
  const credential = await navigator.credentials.create({
    publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(
      started.options,
    ),
  });
  if (!(credential instanceof PublicKeyCredential)) return false;
  return (await completeEnrollment(token, credential.toJSON())).ok;
}

async function signIn(): Promise<boolean> {
  const started = await startSignIn();
  if (!started.ok) return false;
  const credential = await navigator.credentials.get({
    publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(started.options),
  });
  if (!(credential instanceof PublicKeyCredential)) return false;
  return (await completeSignIn(credential.toJSON())).ok;
}

export function PasskeyCeremony({
  kind,
}: {
  readonly kind: 'enroll' | 'sign-in';
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>('idle');
  const run = async () => {
    setStatus('working');
    const ok = await (kind === 'enroll' ? enroll() : signIn()).catch(
      () => false,
    );
    if (!ok) return setStatus('failed');
    router.replace(kind === 'enroll' ? '/sign-in?enrolled=1' : '/accounts');
  };
  return (
    <div>
      <button
        type="button"
        onClick={() => void run()}
        disabled={status === 'working'}
      >
        {kind === 'enroll' ? 'Create passkey' : 'Sign in with a passkey'}
      </button>
      <p role="status">
        {status === 'working'
          ? 'Waiting for your passkey…'
          : status === 'failed'
            ? 'That did not work. Try again, or ask for a new enrollment link.'
            : ''}
      </p>
    </div>
  );
}
