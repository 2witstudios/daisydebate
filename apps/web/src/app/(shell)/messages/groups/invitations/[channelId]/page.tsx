import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { systemId } from '@daisy/clock';
import { messagingGroupInvitationResultSchema } from '@daisy/protocol';
import {
  readMessagingPageChannel,
  type MessagingPageScope,
} from '../../../../../../features/messaging/page-scope';
import { PageHeader } from '../../../../../../ui/components/page-header/page-header';
import { RequestDecision } from '../../../../../../ui/messaging/request-decision';
import { GET } from '../../../../../api/messaging/groups/[channelId]/invitation/route';
import { decideInvitationAction } from './actions';
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
    <main className="mx-auto flex w-full max-w-reading flex-col gap-6 p-6">
      <PageHeader
        title="Group invitation"
        actions={<Link href="/messages">Back to messages</Link>}
      />
      {invitation ? (
        <section className="flex flex-col gap-6 rounded-lg border border-border bg-surface-raised p-5">
          <p>
            You have been invited to a private group. Accept to join, or
            decline.
          </p>
          <RequestDecision
            action={decideInvitationAction.bind(
              null,
              channel,
              invitation.generation,
            )}
            requestId={systemId.next()}
            subject="invitation"
          />
        </section>
      ) : (
        <p role="status">
          This invitation is unavailable. Refresh to try again.
        </p>
      )}
    </main>
  );
}
