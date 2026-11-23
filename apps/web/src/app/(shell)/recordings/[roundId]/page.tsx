import { StatusRegion } from '../../../../ui/components/status-region/status-region';
import type { Metadata } from 'next';
import type { SearchParams } from '../../../../features/access/decision';
import { accountOf } from '../../../../features/access/account-of';
import {
  reportAnswerText,
  reportNotice,
} from '../../../../features/content-moderation/submit-report';
import { recordingViewerOf } from '../../../../features/recording/viewer';
import { readRecordingHistory } from '../../../../features/recording/page-reads';
import { requestIdentity } from '../../../../lib/page-reads';
import { requestPresentedLink } from '../../../../features/audience-link/page-reads';
import {
  RecordingHistory,
  removalNotices,
} from '../../../../ui/recording/recording-history/recording-history';
import { ReportForm } from '../../../../ui/content-moderation/report-form';
import { reportFromPageAction } from '../../audience/actions';
import { SpectateRefusal } from '../../../../ui/watch/spectate-refusal/spectate-refusal';

export const metadata: Metadata = { title: 'Recording' };

const MAX_SEARCH_LENGTH = 80;

const firstOf = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : (value?.[0] ?? '');

const isNotice = (value: string): value is keyof typeof removalNotices =>
  Object.hasOwn(removalNotices, value);

/** A finished Round's video and text history; each panel has its own permission. */
export default async function RecordingPage({
  params,
  searchParams,
}: {
  params: Promise<{ roundId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { roundId } = await params;
  const search = await searchParams;
  const identity = await requestIdentity();
  const screen = await readRecordingHistory({
    roundId,
    viewer: recordingViewerOf(identity),
    presentedLinkHash: await requestPresentedLink(roundId),
    q: firstOf(search['q']).trim().slice(0, MAX_SEARCH_LENGTH),
  });
  const notice = firstOf(search['removal']);
  const reported = reportNotice(search['report']);
  const returnTo = `/recordings/${encodeURIComponent(roundId)}`;
  return screen.kind === 'history' ? (
    <RecordingHistory
      screen={screen}
      notice={isNotice(notice) ? notice : null}
      report={
        accountOf(identity) ? (
          <>
            {reported ? (
              <StatusRegion
                as="p"
                role="status"
                className="text-sm text-ink-muted"
              >
                {reportAnswerText(reported)}
              </StatusRegion>
            ) : null}
            <ReportForm
              {...screen.reportTarget}
              action={reportFromPageAction.bind(null, returnTo)}
            />
          </>
        ) : null
      }
    />
  ) : (
    <div className="px-6 pt-8 pb-8 max-compact:px-4">
      <SpectateRefusal />
    </div>
  );
}
