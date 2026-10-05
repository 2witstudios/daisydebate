import type { ReactNode } from 'react';
import { Button } from '../../components/button/button';
import type { ButtonVariant } from '../../components/button/button-class';
import { Icon } from '../../components/icon/icon';
import { AuthFrame, AuthHeading, taglinePanel } from '../auth-frame/auth-frame';
import { Notice } from '../notice/notice';

export type SavePasskeyProps = {
  /** The public username the account just claimed. */
  readonly username: string;
  readonly pending: boolean;
  readonly savePasskey: () => void;
  /**
   * The POST that declines without saving a passkey (shared computer, or
   * not now). A real form action, so both choices are buttons plain Tab
   * reaches in every engine and both still work before hydration and
   * without JavaScript.
   */
  readonly decline: (form: FormData) => void | Promise<void>;
  /** Why the last attempt saved nothing; never a success. */
  readonly notice?: string | undefined;
};

/** A choice that leaves without a passkey; unavailable while one is saving. */
function DeclineButton({
  decline,
  variant,
  locked,
  className,
  children,
}: {
  readonly decline: (form: FormData) => void | Promise<void>;
  readonly variant: ButtonVariant;
  readonly locked: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <form action={decline}>
      <Button
        type="submit"
        variant={variant}
        disabled={locked}
        className={className}
      >
        {children}
      </Button>
    </form>
  );
}

/**
 * Offered right after an emailed sign-in, when skipping the inbox is the
 * benefit people just felt. Shared computers opt out instead of saving.
 */
export function SavePasskey({
  username,
  pending,
  savePasskey,
  decline,
  notice,
}: SavePasskeyProps) {
  return (
    <AuthFrame
      panel={taglinePanel}
      footer="On a school or library computer, choose shared."
    >
      <p className="flex items-center gap-2 self-start rounded-round bg-accent-soft px-3 py-1 text-sm font-semibold text-accent-strong">
        <Icon name="check" size={16} />
        Signed in as {username}
      </p>
      <AuthHeading eyebrow="Faster next time" title="Next time, one tap.">
        Sign in with your face, fingerprint, or screen lock.
      </AuthHeading>
      <div className="flex flex-col items-start gap-3">
        <div className="flex flex-wrap gap-3">
          <Button
            disabled={pending}
            onClick={savePasskey}
            className="h-auth-control"
          >
            <Icon name="key" />
            {pending
              ? 'Waiting for your device…'
              : 'Save a passkey on this device'}
          </Button>
          <DeclineButton
            decline={decline}
            variant="secondary"
            locked={pending}
            className="h-auth-control"
          >
            <Icon name="users" />
            This is a shared computer
          </DeclineButton>
        </div>
        {notice === undefined ? null : (
          <Notice id="save-passkey-notice" tone="info" title={notice} />
        )}
        <DeclineButton
          decline={decline}
          variant="ghost"
          locked={pending}
          className="-ml-3"
        >
          Not now
        </DeclineButton>
      </div>
    </AuthFrame>
  );
}
