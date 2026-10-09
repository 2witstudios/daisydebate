import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { systemId } from '@daisy/clock';
import { idSchema } from '@daisy/protocol';
import { requireAccess } from '../../../../../lib/access';
import type { SearchParams } from '../../../../../features/access/decision';
import { readRequestPreviewResponse } from '../../../../../features/messaging/request-preview';
import { PageHeader } from '../../../../../ui/components/page-header/page-header';
import { RequestDecision } from '../../../../../ui/messaging/request-decision';
import { GET } from '../../../../api/messaging/requests/[channelId]/route';
import { decideDmAction } from './actions';
export const metadata = { title: 'Message request' };
export default async function MessageRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ channelId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/messages', searchParams);
  const channel = idSchema.safeParse((await params).channelId);
  if (!channel.success) notFound();
  const response = await GET(
    new Request(
      `http://in-process.invalid/api/messaging/requests/${channel.data}`,
      { headers: new Headers(await headers()) },
    ),
  );
  if (response.status === 404) notFound();
  const preview = await readRequestPreviewResponse(response);
  return (
    <main className="mx-auto flex w-full max-w-reading flex-col gap-6 p-6">
      <PageHeader
        title="Message request"
        actions={<Link href="/lobby">Back to lobby</Link>}
      />
      {preview ? (
        <section className="flex flex-col gap-6 rounded-lg border border-border bg-surface-raised p-5">
          <p className="whitespace-pre-wrap text-ink">
            {preview.introduction ?? 'No introduction.'}
          </p>
          <RequestDecision
            action={decideDmAction.bind(null, channel.data)}
            requestId={systemId.next()}
          />
        </section>
      ) : (
        <p role="status" className="text-ink-muted">
          This request is unavailable. Refresh to try again.
        </p>
      )}
    </main>
  );
}
