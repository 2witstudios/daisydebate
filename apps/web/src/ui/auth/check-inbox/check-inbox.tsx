import { Button } from '../../components/button/button';
import { Icon } from '../../components/icon/icon';
import { AuthFrame, AuthHeading, taglinePanel } from '../auth-frame/auth-frame';
import { formatCountdown } from '../sign-in-state';

export type CheckInboxProps = {
  readonly email: string;
  /** Time left before a resend is allowed; 0 when it is. */
  readonly resendInMs: number;
  readonly resending: boolean;
  readonly resend: () => void;
  readonly changeEmail: () => void;
};

/** The inbox step's headline, where focus lands when a link is sent. */
export const CHECK_INBOX_HEADING_ID = 'check-inbox-heading';

const resendLabel = (resendInMs: number, resending: boolean): string => {
  if (resending) return 'Sending…';
  return resendInMs > 0
    ? `Resend in ${formatCountdown(resendInMs)}`
    : 'Resend link';
};

/**
 * Tells people where the link went, how long it lasts, and what to do if it
 * does not arrive. It never confirms that an account exists.
 */
export function CheckInbox({
  email,
  resendInMs,
  resending,
  resend,
  changeEmail,
}: CheckInboxProps) {
  return (
    <AuthFrame panel={taglinePanel}>
      <AuthHeading
        id={CHECK_INBOX_HEADING_ID}
        eyebrow="Link on its way"
        title="Check your inbox."
      >
        If <strong className="font-semibold text-ink">{email}</strong> can
        receive email, a sign-in link is on its way. It works once and expires
        in 5 minutes.
      </AuthHeading>
      <div className="flex items-start gap-3 rounded-md border border-border bg-surface p-4 text-base text-ink-muted">
        <Icon name="clock" className="mt-1 text-accent" />
        <p>Not there? Check spam or quarantine.</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          disabled={resending || resendInMs > 0}
          onClick={resend}
          className="h-auth-control"
        >
          {resendLabel(resendInMs, resending)}
        </Button>
        <Button variant="ghost" disabled={resending} onClick={changeEmail}>
          Use a different email
        </Button>
      </div>
    </AuthFrame>
  );
}
