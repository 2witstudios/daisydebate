import type { Metadata } from 'next';
import type { SearchParams } from '../../../../features/access/decision';
import {
  reportAnswerText,
  reportNotice,
} from '../../../../features/content-moderation/submit-report';
import { redirectUnlessLaunched } from '../../../../features/coming-soon/launch-gate';
import { accountOf } from '../../../../features/access/account-of';
import {
  requestIdentity,
  requestWatchRound,
} from '../../../../lib/request-session';
import { ReportForm } from '../../../../ui/content-moderation/report-form';
import { reportFromPageAction } from '../../audience/actions';
import { RoundAudience } from '../../audience/round-audience';
import { BroadcastViewer } from '../../../../ui/spectating/broadcast-viewer';
import { SpectateRefusal } from '../../../../ui/watch/spectate-refusal/spectate-refusal';
import { WatchBusy } from '../../../../ui/watch/watch-busy/watch-busy';

export const metadata: Metadata = { title: 'Live debate' };

/**
 * The public Round page. Watching needs no account and no device: it reads the
 * released snapshot and plays the Broadcast's public feed, and is never in the
 * debate's room. An audience of everyone is the same read for everyone.
 */
export default async function WatchRoundPage({
  params,
  searchParams,
}: {
  params: Promise<{ roundId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  redirectUnlessLaunched('watch');
  const { roundId } = await params;
  const timeline = await requestWatchRound(roundId);
  const reported = reportNotice((await searchParams)['report']);
  const returnTo = `/watch/${encodeURIComponent(roundId)}`;
  if (timeline === 'refused')
    return (
      <div className="px-6 pt-8 pb-8 max-compact:px-4">
        <WatchBusy retryHref={returnTo} />
      </div>
    );
  const account = accountOf(await requestIdentity());
  return timeline ? (
    <BroadcastViewer initial={timeline}>
      {reported ? (
        <p role="status" className="text-sm text-ink-muted">
          {reportAnswerText(reported)}
        </p>
      ) : null}
      <RoundAudience roundId={roundId} returnTo={returnTo} />
      {account ? (
        <ReportForm
          targetKind="round"
          targetId={timeline.roundId}
          label="Report this round"
          action={reportFromPageAction.bind(null, returnTo)}
        />
      ) : null}
    </BroadcastViewer>
  ) : (
    <div className="px-6 pt-8 pb-8 max-compact:px-4">
      <SpectateRefusal />
    </div>
  );
}
