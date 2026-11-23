import type { Metadata } from 'next';
import { systemId } from '@daisy/clock';
import { requestSupportReplyAddress } from '../../../lib/request-session';
import { SupportPage } from '../../../ui/support/support-page';
import { sendSupportMessageAction } from './actions';

export const metadata: Metadata = {
  title: 'Contact support',
  description:
    'Ask for help with Daisy Debate, report a problem or send us an idea.',
  alternates: { canonical: '/support' },
};

/**
 * Public (SUPP-1): anyone, signed in or not, can ask for help or send
 * feedback. Each render chooses the message's id, so sending the same form
 * twice stores it once; a signed-in member's reply address starts as their
 * account's email.
 */
export default async function Support() {
  return (
    <SupportPage
      messageId={systemId.next()}
      replyEmail={await requestSupportReplyAddress()}
      action={sendSupportMessageAction}
    />
  );
}
