import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { audienceLinkPageHref } from '../../../../../features/audience-link/audience-link';
import { accessOrTemporary } from '../../../../../lib/access';
import type { SearchParams } from '../../../../../features/access/decision';
import { requestHostedAudienceLink } from '../../../../../lib/request-session';
import { AudienceLinkPanel } from '../../../../../ui/spectating/audience-link-panel/audience-link-panel';
import { reconnectingRoundPage } from '../../../../../ui/debate-room/round-reconnecting';
import { issueAudienceLinkAction } from './actions';

export const metadata: Metadata = { title: 'Share by link' };

/** The host's page for an unlisted Round's link; anyone else finds no such page. */
export default async function AudienceLinkPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const access = await accessOrTemporary(
    audienceLinkPageHref(id),
    searchParams,
  );
  if (access.kind === 'temporary') return reconnectingRoundPage();
  const hosted = await requestHostedAudienceLink(id, access.identity);
  if (hosted === null) notFound();
  return (
    <div className="px-6 pt-8 pb-8 max-compact:px-4">
      <AudienceLinkPanel
        issued={hosted.issued}
        action={issueAudienceLinkAction.bind(null, id)}
      />
    </div>
  );
}
