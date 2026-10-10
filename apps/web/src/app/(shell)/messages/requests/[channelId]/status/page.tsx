import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { systemId } from '@daisy/clock';
import { idSchema, messagingDmResultSchema } from '@daisy/protocol';
import { requireAccess } from '../../../../../../lib/access';
import type { SearchParams } from '../../../../../../features/access/decision';
import { PageHeader } from '../../../../../../ui/components/page-header/page-header';
import { RequestDecision } from '../../../../../../ui/messaging/request-decision';
import { GET } from '../../../../../api/messaging/requests/[channelId]/status/route';
import { decideDmAction } from '../actions';
export const metadata = { title: 'Sent request' };
export default async function SentRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ channelId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/messages', searchParams);
  const id = idSchema.safeParse((await params).channelId);
  if (!id.success) notFound();
  const response = await GET(
    new Request(
      `http://in-process.invalid/api/messaging/requests/${id.data}/status`,
      { headers: new Headers(await headers()) },
    ),
  );
  const result = response.ok
    ? messagingDmResultSchema.safeParse(await response.json())
    : null;
  const pending =
    result?.success &&
    result.data.channelId === id.data &&
    result.data.state === 'pending';
  return (
    <main className="mx-auto flex w-full max-w-reading flex-col gap-6 p-6">
      <PageHeader
        title="Sent request"
        actions={<Link href="/messages">Back to messages</Link>}
      />
      {pending ? (
        <>
          <p>Your message request is waiting for a response.</p>
          <RequestDecision
            mode="sender"
            action={decideDmAction.bind(null, id.data)}
            requestId={systemId.next()}
          />
        </>
      ) : (
        <p role="status">
          This request is unavailable or has already been decided. Return to
          messages for its current status.
        </p>
      )}
    </main>
  );
}
