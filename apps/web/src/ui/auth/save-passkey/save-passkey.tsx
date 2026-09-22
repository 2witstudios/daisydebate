import { Button } from '../../components/button/button';
import { Icon } from '../../components/icon/icon';
import { AuthFrame, AuthHeading } from '../auth-frame/auth-frame';
import { Notice } from '../notice/notice';

export type SavePasskeyProps = {
  /** The public username the account just claimed. */
  readonly username: string;
  readonly pending: boolean;
  readonly savePasskey: () => void;
  /** Never offer a passkey on this device again: it is shared. */
  readonly markShared: () => void;
  readonly dismiss: () => void;
  /** Why the last attempt saved nothing; never a success. */
  readonly notice?: string | undefined;
};

const savedFacts = [
  'Stays on your device or in your password manager',
  'Works only on Daisy, so look-alike sites get nothing',
  'Email links keep working as a backup',
] as const;

/**
 * Offered right after an emailed sign-in, when skipping the inbox is the
 * benefit people just felt. Shared computers opt out instead of saving.
 */
export function SavePasskey({
  username,
  pending,
  savePasskey,
  markShared,
  dismiss,
  notice,
}: SavePasskeyProps) {
  return (
    <AuthFrame
      panel={{
        eyebrow: 'What gets saved',
        title: 'A key that only opens Daisy.',
        body: (
          <ul className="flex flex-col gap-3">
            {savedFacts.map((fact) => (
              <li key={fact} className="flex items-start gap-3">
                <Icon name="check" size={18} className="mt-1 text-accent" />
                <span>{fact}</span>
              </li>
            ))}
          </ul>
        ),
      }}
      footer="On a school or library computer, choose shared. You will keep signing in by email there, and we will not ask again on it."
    >
      <p className="flex items-center gap-2 self-start rounded-round bg-accent-soft px-3 py-1 text-sm font-semibold text-accent-strong">
        <Icon name="check" size={16} />
        Signed in as {username}
      </p>
      <AuthHeading eyebrow="Faster next time" title="Next time, one tap.">
        Save a passkey and sign in with your face, fingerprint, or screen lock.
        No inbox wait, and nothing a fake site can steal.
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
          <Button
            variant="secondary"
            disabled={pending}
            onClick={markShared}
            className="h-auth-control"
          >
            <Icon name="users" />
            This is a shared computer
          </Button>
        </div>
        {notice === undefined ? null : (
          <Notice id="save-passkey-notice" tone="info" title={notice} />
        )}
        <Button
          variant="ghost"
          disabled={pending}
          onClick={dismiss}
          className="-ml-3"
        >
          Not now
        </Button>
      </div>
    </AuthFrame>
  );
}
