import { ConversationPane } from '../../../../ui/messaging/conversation-pane';
import { systemId } from '@daisy/clock';
import { requireAccess } from '../../../../lib/access';
import { privateGroupsOffered } from '../../../../lib/request-session';
import type { SearchParams } from '../../../../features/access/decision';
import { ConversationCreation } from '../../../../ui/messaging/conversation-creation';
import { createConversationAction } from './actions';
export const metadata = { title: 'Start a conversation' };
export default async function NewConversationPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/messages/new', searchParams);
  const kind =
    (await searchParams).kind === 'group' && privateGroupsOffered()
      ? 'private_group'
      : 'dm';
  return (
    <ConversationPane title={kind === 'dm' ? 'Message someone' : 'Create private group'}>
      <ConversationCreation
        kind={kind}
        requestId={systemId.next()}
        action={createConversationAction.bind(null, kind)}
      />
    </ConversationPane>
  );
}
