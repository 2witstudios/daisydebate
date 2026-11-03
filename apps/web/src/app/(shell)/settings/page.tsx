import type { Metadata } from 'next';
import { claimedUsername } from '@daisy/auth';
import type { SearchParams } from '../../../features/access/decision';
import { requireAccess } from '../../../lib/access';
import { parseDataRightsQuery } from '../../../features/account/data-rights/notices';
import {
  requestIdentity,
  requestAnalytics,
  requestOnboardingAnswers,
  requestOptionalAnswersAdmitted,
} from '../../../lib/request-session';
import { answerEditHrefs } from '../../../ui/onboarding/answer-summary/answer-summary';
import { SettingsPage } from '../../../ui/settings/preferences/settings-page';
import { saveRatingVisibilityAction } from './actions';
import { ratingVisibilitySchema } from '@daisy/protocol';
import { GET as readRatingVisibility } from '../../api/ratings/visibility/route';
import { readOwnRoute } from '../friends/read-route';
import { RatingVisibilityForm } from '../../../ui/settings/preferences/rating-visibility-form';

export const metadata: Metadata = { title: 'Settings' };

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
