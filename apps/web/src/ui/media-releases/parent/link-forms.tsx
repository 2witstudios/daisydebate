'use client';

import {
  initialSentState,
  parentUnacknowledged,
  type SentState,
} from '../../../features/media-releases/parent-forms';
import { Button } from '../../components/button/button';
import {
  controlClass,
  fieldClass,
  helperClass,
  labelClass,
} from '../../components/form-field/form-field-class';
import { useFormAction, type FormAction } from '../../form-action/form-action';
import { Problem } from './problem';
import { ReleaseNotice } from './release-frame';

/**
 * Asks for a fresh manage link by the address that signed. The answer is
 * the same whether or not a release is on file for it.
 */
export function AskForLink({
  why,
  mail,
}: {
  readonly why: 'none' | 'expired' | 'used';
  readonly mail: FormAction<SentState>;
}) {
  const [state, send, pending] = useFormAction(
    mail,
    initialSentState,
    parentUnacknowledged,
  );
  const title = {
    none: 'Manage a media release',
    expired: 'This link has expired',
    used: 'This link has been used',
  }[why];
  return (
    <ReleaseNotice title={title}>
      {state.kind === 'sent' ? (
        <p role="status">
          If a release is on file for that address, we sent a link to it.
        </p>
      ) : (
        <form action={send} className="flex flex-col gap-4">
          <p>
            Each link works once. Enter the address you signed with and we’ll
            email you a new one.
          </p>
          <div className={fieldClass}>
            <label htmlFor="release-email" className={labelClass}>
              Your email
            </label>
            <input
              id="release-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              defaultValue={
                state.kind === 'idle' ? '' : (state.values['email'] ?? '')
              }
              className={controlClass}
            />
            <span className={helperClass}>
              We never say whether we found it.
            </span>
          </div>
          <Problem state={state} />
          <Button
            type="submit"
            className="min-h-release-target self-start"
            aria-busy={pending}
          >
            Email me a link
          </Button>
        </form>
      )}
    </ReleaseNotice>
  );
}

/** A sign link already used to sign: the parent can have a manage link mailed. */
export function AlreadySigned({
  minor,
  mail,
}: {
  readonly minor: string;
  readonly mail: FormAction<SentState>;
}) {
  const [state, send, pending] = useFormAction(
    mail,
    initialSentState,
    parentUnacknowledged,
  );
  return (
    <ReleaseNotice title={`@${minor}’s release is signed.`}>
      <p>
        This link was used to sign it. Your copy, with a link to withdraw or
        change the paid-ads choice, went to the address that signed.
      </p>
      {state.kind === 'sent' ? (
        <p role="status">We emailed a new link to that address.</p>
      ) : (
        <form action={send} className="flex flex-col gap-3">
          <Problem state={state} />
          <Button
            type="submit"
            variant="secondary"
            className="min-h-release-target self-start"
            aria-busy={pending}
          >
            Email me a new link
          </Button>
        </form>
      )}
    </ReleaseNotice>
  );
}

/** "Don't send me release requests": one button, for the address the link names. */
export function StopRequests({
  stop,
}: {
  readonly stop: FormAction<SentState>;
}) {
  const [state, send, pending] = useFormAction(
    stop,
    initialSentState,
    parentUnacknowledged,
  );
  return (
    <ReleaseNotice title="Stop release requests">
      {state.kind === 'sent' ? (
        <p role="status">
          Done. Daisy won’t send release requests to this address again.
        </p>
      ) : (
        <form action={send} className="flex flex-col gap-4">
          <p>
            Daisy won’t send media release requests to this address again,
            whoever asks.
          </p>
          <Problem state={state} />
          <Button
            type="submit"
            className="min-h-release-target self-start"
            aria-busy={pending}
          >
            Don’t send me release requests
          </Button>
        </form>
      )}
    </ReleaseNotice>
  );
}
