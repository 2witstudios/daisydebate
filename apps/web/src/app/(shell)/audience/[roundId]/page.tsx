import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  reportNotice,
  reportAnswerText,
} from '../../../../features/content-moderation/submit-report';
import type { SearchParams } from '../../../../features/access/decision';
import { requestWatchRound } from '../../../../lib/request-session';
import { PublishedAudienceFeed } from '../../../../ui/spectating/published-audience-feed';
import { RoundAudience } from '../round-audience';

export const metadata: Metadata = {
  title: 'Audience',
  robots: { index: false },
};

/**
 * A Round's audience on a page of its own, beside the broadcast or in place of
 * it: chat, reactions and the count. Reading needs no account.
 */
export default async function AudiencePage({
  params,
  searchParams,
}: {
  params: Promise<{ roundId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { roundId } = await params;
  const reported = reportNotice((await searchParams)['report']);
  const audience = await RoundAudience({
    roundId,
    returnTo: `/audience/${encodeURIComponent(roundId)}`,
  });
  if (!audience) notFound();
  const watched = await requestWatchRound(roundId);
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-4 px-6 pt-5 pb-8 max-compact:px-4">
      {reported ? (
        <p role="status" className="text-sm text-ink-muted">
          {reportAnswerText(reported)}
        </p>
      ) : null}
      <PublishedAudienceFeed
        stateUrl={watched && watched !== 'refused' ? watched.stateUrl : null}
      >
        {audience}
      </PublishedAudienceFeed>
    </div>
  );
}
