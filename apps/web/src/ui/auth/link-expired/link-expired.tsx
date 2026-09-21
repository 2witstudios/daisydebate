import { Button } from '../../components/button/button';
import { AuthFrame, AuthHeading, taglinePanel } from '../auth-frame/auth-frame';
import { EmailField } from '../email-field/email-field';
import { LinkForm, type LinkFormTarget } from '../link-form';
import { Notice } from '../notice/notice';

export type LinkExpiredProps = {
  readonly target: LinkFormTarget;
  readonly notice?: string | undefined;
};

/** A used or expired link: say what happened, then fix it in place. */
export function LinkExpired({ target, notice }: LinkExpiredProps) {
  return (
    <AuthFrame panel={taglinePanel}>
      <AuthHeading
        eyebrow="Link expired"
        title="This link can no longer be used."
        muted
      >
        Sign-in links expire after 5 minutes and work only once. Enter your
        email for a new one. Nothing is sent until you ask.
      </AuthHeading>
      {notice === undefined ? null : (
        <Notice id="expired-notice" tone="error" title={notice} />
      )}
      <LinkForm target={target} className="flex flex-col">
        <EmailField
          id="expired-email"
          label="Email address"
          autoComplete="email"
          action={
            <Button type="submit" className="h-auth-control">
              Email me a new link
            </Button>
          }
        />
      </LinkForm>
    </AuthFrame>
  );
}
