import type { FormAction } from '../form-action/form-action';
import { PageHeader } from '../components/page-header/page-header';
import { ReadingPage } from '../components/reading-page/reading-page';
import type { MessageFormState } from '../../features/support/message-form';
import { SupportForm } from './support-form';

/** /support (SUPP-1): one form for help and feedback, signed in or not. */
export function SupportPage({
  messageId,
  replyEmail,
  action,
}: {
  readonly messageId: string;
  readonly replyEmail: string;
  readonly action: FormAction<MessageFormState>;
}) {
  return (
    <ReadingPage>
      <PageHeader
        title="Contact support"
        lede="Ask for help, tell us what went wrong, or send an idea."
      />
      <SupportForm
        messageId={messageId}
        replyEmail={replyEmail}
        action={action}
      />
    </ReadingPage>
  );
}
