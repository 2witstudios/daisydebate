import { ConversationPane } from '../../../../ui/messaging/conversation-pane';
import { systemId } from '@daisy/clock';
import { requireAccess } from '../../../../lib/access';
import type { SearchParams } from '../../../../features/access/decision';
import { ContactBlockForm } from '../../../../ui/contacts/contact-block-form';
import { blockContactAction } from './actions';
export const metadata = { title: 'Contact safety' };
export default async function ContactSafetyPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/messages/contacts', searchParams);
  return (
    <ConversationPane title="Contact safety">
      <p>
        Block someone to prevent new private messages between you. Unblocking
        does not accept a message request.
      </p>
      <ContactBlockForm
        requestId={systemId.next()}
        action={blockContactAction}
      />
    </ConversationPane>
  );
}
