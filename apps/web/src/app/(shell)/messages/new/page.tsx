import { systemId } from '@daisy/clock';
import Link from 'next/link';
import { requireAccess } from '../../../../lib/access';
import type { SearchParams } from '../../../../features/access/decision';
import { PageHeader } from '../../../../ui/components/page-header/page-header';
import { ConversationCreation } from '../../../../ui/messaging/conversation-creation';
import { createConversationAction } from './actions';
export const metadata = { title: 'Start a conversation' };
export default async function NewConversationPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/messages/new', searchParams);
  const kind = (await searchParams).kind === 'group' ? 'private_group' : 'dm';
  return (
    <main className="mx-auto flex w-full max-w-reading flex-col gap-6 p-6">
      <PageHeader
        title={kind === 'dm' ? 'Message someone' : 'Create private group'}
        actions={<Link href="/messages">Back to messages</Link>}
      />
      <ConversationCreation
        kind={kind}
        requestId={systemId.next()}
        action={createConversationAction.bind(null, kind)}
      />
    </main>
  );
}
