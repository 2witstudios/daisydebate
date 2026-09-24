'use client';

import { useActionState, useState } from 'react';
import {
  initialUsernameForm,
  refusesShape,
  shownNotice,
  type LocalNotice,
  type UsernameFormState,
} from './claim-form';
import { UsernameForm } from './username-form';

/** The username claim: a server action bound to the validated destination. */
export type ClaimAction = (
  state: UsernameFormState,
  form: FormData,
) => Promise<UsernameFormState>;

/**
 * Username onboarding. The form posts to `claim`, a server action, so a
 * submission before hydration or without JavaScript is the same POST; the
 * action moves a claimed account on to the passkey offer. JavaScript only
 * adds the local shape check and the pending state.
 */
export function Onboarding({
  claim,
  signInHref,
}: {
  readonly claim: ClaimAction;
  readonly signInHref: string;
}) {
  const [answered, post, pending] = useActionState(claim, initialUsernameForm);
  const [local, setLocal] = useState<LocalNotice>(undefined);
  return (
    <UsernameForm
      username={answered.username}
      pending={pending}
      notice={shownNotice(local, answered.notice)}
      action={post}
      check={(username) => {
        const refused = refusesShape(username);
        setLocal(refused ? 'invalid' : undefined);
        return !refused;
      }}
      edited={() => setLocal('edited')}
      signInHref={signInHref}
    />
  );
}
