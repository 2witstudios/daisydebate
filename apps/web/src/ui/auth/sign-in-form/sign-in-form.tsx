import { Button } from '../../components/button/button';
import { Icon } from '../../components/icon/icon';
import { AuthFrame, AuthHeading, taglinePanel } from '../auth-frame/auth-frame';
import { EmailField } from '../email-field/email-field';
import { CopyNotice } from '../notice/notice';
import { signInNotices } from '../sign-in-notices';
import type { SignInNotice, SignInState } from '../sign-in-state';

export type SignInFormProps = {
  readonly email: string;
  readonly pending: Extract<SignInState, { step: 'enter-email' }>['pending'];
  readonly notice?: SignInNotice | undefined;
  readonly typeEmail: (email: string) => void;
  readonly requestLink: () => void;
  readonly signInWithPasskey: () => void;
};

const NOTICE_ID = 'sign-in-notice';
const PASSKEY_HINT_ID = 'sign-in-passkey-hint';

const pendingStatus = {
  none: '',
  link: 'Sending your sign-in link…',
  passkey: "Follow your browser's prompt to use your passkey.",
} as const;

/**
 * One email field for new and returning people alike. A saved passkey is
 * offered by the browser's autofill (`username webauthn`) and by the quieter
 * passkey button for browsers without it. The button can only use a passkey
 * that already exists (a WebAuthn `get()`), so its hint sends new people to
 * email; they save a passkey after their first sign-in.
 */
export function SignInForm({
  email,
  pending,
  notice,
  typeEmail,
  requestLink,
  signInWithPasskey,
}: SignInFormProps) {
  const busy = pending !== 'none';
  const copy = notice === undefined ? undefined : signInNotices[notice];
  const refusesEmail = notice === 'undeliverable';
  return (
    <AuthFrame panel={taglinePanel}>
      <AuthHeading
        eyebrow="Sign in or create an account"
        title="Take the floor."
      >
        Enter your email and we&apos;ll send you a link. Saved a passkey? Your
        browser will offer it.
      </AuthHeading>
      <form
        className="flex flex-col gap-3"
        aria-busy={busy}
        onSubmit={(event) => {
          event.preventDefault();
          requestLink();
        }}
      >
        <EmailField
          id="sign-in-email"
          label="Email"
          autoComplete="username webauthn"
          value={email}
          typeEmail={typeEmail}
          disabled={busy}
          {...(refusesEmail ? { errorId: NOTICE_ID } : {})}
          action={
            <Button type="submit" disabled={busy} className="h-auth-control">
              {pending === 'link' ? 'Sending…' : 'Continue'}
              <Icon name="arrowRight" size={18} />
            </Button>
          }
        />
        <CopyNotice id={NOTICE_ID} copy={copy} />
      </form>
      <div className="flex flex-col items-start gap-2">
        <Button
          variant="secondary"
          disabled={busy}
          onClick={signInWithPasskey}
          aria-describedby={PASSKEY_HINT_ID}
          className="h-auth-control"
        >
          <Icon name="key" />
          {pending === 'passkey'
            ? 'Waiting for your passkey…'
            : 'Sign in with a passkey'}
        </Button>
        <p id={PASSKEY_HINT_ID} className="text-sm text-ink-muted">
          For returning users. New here? Use your email.
        </p>
      </div>
      <p role="status" className="sr-only">
        {pendingStatus[pending]}
      </p>
    </AuthFrame>
  );
}
