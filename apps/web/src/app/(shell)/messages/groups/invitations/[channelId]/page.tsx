import { ConversationPane } from '../../../../../../ui/messaging/conversation-pane';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { systemId } from '@daisy/clock';
import { messagingGroupInvitationResultSchema } from '@daisy/protocol';
import {
  readMessagingPageChannel,
  type MessagingPageScope,
} from '../../../../../../features/messaging/page-scope';
import { RequestDecision } from '../../../../../../ui/messaging/request-decision';
import { GET } from '../../../../../api/messaging/groups/[channelId]/invitation/route';
import { decideInvitationAction } from './actions';
import { privateGroupsOffered } from '../../../../../../lib/request-session';
export const metadata = { title: 'Group invitation' };
export default async function GroupInvitationPage({
  params,
  searchParams,
}: MessagingPageScope) {
  const channel = await readMessagingPageChannel({ params, searchParams });
  const response = await GET(
    new Request(
      `http://in-process.invalid/api/messaging/groups/${channel}/invitation`,
      { headers: new Headers(await headers()) },
    ),
  );
  if (response.status === 404) notFound();
  const result = response.ok
    ? messagingGroupInvitationResultSchema.safeParse(await response.json())
    : null;
  const invitation =
    result?.success &&
    result.data.channelId === channel &&
    result.data.state === 'pending'
      ? result.data
      : null;
  return (
    <ConversationPane title="Group invitation">
      {invitation ? (
        <section className="flex max-w-reading flex-col gap-6">
          <p>
            {privateGroupsOffered()
              ? 'You have been invited to a private group. Accept to join, or decline.'
              : 'You have been invited to a private group. Private groups are not available in the beta, so you can only decline.'}
          </p>
          <RequestDecision
            action={decideInvitationAction.bind(
              null,
              channel,
              invitation.generation,
            )}
            requestId={systemId.next()}
            subject="invitation"
            acceptable={privateGroupsOffered()}
          />
        </section>
      ) : (
        <p role="status">
          This invitation is unavailable. Refresh to try again.
        </p>
      )}
    </ConversationPane>
  );
}
