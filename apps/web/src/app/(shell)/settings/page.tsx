import type { Metadata } from 'next';
import { claimedUsername } from '@daisy/auth';
import type { SearchParams } from '../../../features/access/decision';
import { requireAccess } from '../../../lib/access';
import { parseDataRightsQuery } from '../../../features/account/data-rights/notices';
import {
  requestIdentity,
  requestAnalytics,
  requestAudienceSettings,
  requestOnboardingAnswers,
  requestOptionalAnswersAdmitted,
} from '../../../lib/request-session';
import { answerEditHrefs } from '../../../ui/onboarding/answer-summary/answer-summary';
import { SettingsPage } from '../../../ui/settings/preferences/settings-page';
import { saveRatingVisibilityAction } from './actions';
import {
  clearWatchHistoryAction,
  forgetWatchedAction,
  saveNotificationPreferencesAction,
} from '../audience/actions';
import { NotificationPreferencesForm } from '../../../ui/notifications/notification-preferences-form';
import { WatchHistoryList } from '../../../ui/watch-history/watch-history-list';
import { ratingVisibilitySchema } from '@daisy/protocol';
import { GET as readRatingVisibility } from '../../api/ratings/visibility/route';
import { readOwnRoute } from '../friends/read-route';
import { RatingVisibilityForm } from '../../../ui/settings/preferences/rating-visibility-form';

export const metadata: Metadata = { title: 'Settings' };

/** The member's stored notification choices and their watch history. */
async function audienceSections(userId: string) {
  const { preferences, history } = await requestAudienceSettings(userId);
  return {
    notifications: (
      <NotificationPreferencesForm
        action={saveNotificationPreferencesAction}
        choices={preferences}
      />
    ),
    watchHistory: (
      <WatchHistoryList
        clear={clearWatchHistoryAction}
        entries={history.map((entry) => ({
          ...entry,
          forget: forgetWatchedAction.bind(null, entry.roundId),
        }))}
      />
    ),
  };
}

export default async function SettingsRoute({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/settings', searchParams);
  const identity = await requestIdentity();
  const query = await searchParams;
  // ISSUE-324: optional answers only where they are asked (16+, ISSUE-645).
  const [admitted, ownAnswers] = await Promise.all([
    requestOptionalAnswersAdmitted(),
    requestOnboardingAnswers(),
  ]);
  const answers = admitted ? ownAnswers : null;
  const visibility = await readOwnRoute(
    readRatingVisibility,
    '/api/ratings/visibility',
    ratingVisibilitySchema,
  );
  return (
    <SettingsPage
      {...('principal' in identity && identity.principal.kind === 'user'
        ? await audienceSections(identity.principal.userId)
        : {})}
      username={claimedUsername(identity)}
      dataRightsNotices={parseDataRightsQuery(query)}
      analytics={await requestAnalytics()}
      ratingCard={
        visibility ? (
          <RatingVisibilityForm
            action={saveRatingVisibilityAction}
            visibility={visibility}
          />
        ) : null
      }
      onboarding={
        answers === null
          ? null
          : { answers, editHrefs: answerEditHrefs('/settings', true) }
      }
    />
  );
}
