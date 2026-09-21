import { Button } from '../../components/button/button';
import { Icon } from '../../components/icon/icon';
import { AuthFrame, AuthHeading } from '../auth-frame/auth-frame';
import { LinkForm, type LinkFormTarget } from '../link-form';
import { Notice } from '../notice/notice';

export type ConfirmSignInProps = {
  readonly target: LinkFormTarget;
  /** A refusal from the last attempt, already safe to show. */
  readonly notice?: string | undefined;
};

/**
 * The page an emailed link opens. The extra tap is what stops mail scanners
 * that pre-open links from using the link up, so the panel says so.
 */
export function ConfirmSignIn({ target, notice }: ConfirmSignInProps) {
  return (
    <AuthFrame
      panel={{
        eyebrow: 'Why one more tap?',
        title: 'Only you can use your link.',
        body: 'Email security scanners open links to check them. Asking for a tap here means a scanner cannot use up your link, and nobody else can use it either.',
      }}
      footer="Did not ask to sign in? Close this page. Nothing happens unless you select the button."
    >
      <AuthHeading eyebrow="One more step" title="Confirm sign-in.">
        Select the button to finish signing in to Daisy on this device.
      </AuthHeading>
      {notice === undefined ? null : (
        <Notice id="confirm-notice" tone="error" title={notice} />
      )}
      <LinkForm target={target} className="flex">
        <Button type="submit" className="h-auth-control">
          Sign in to Daisy
          <Icon name="arrowRight" size={18} />
        </Button>
      </LinkForm>
    </AuthFrame>
  );
}
