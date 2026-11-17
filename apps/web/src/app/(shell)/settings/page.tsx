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
import { savePublicProfileAction } from './actions';
import {
  clearWatchHistoryAction,
  forgetWatchedAction,
  saveNotificationPreferencesAction,
  saveNotificationPresentationAction,
} from '../audience/actions';
import { NotificationPreferencesForm } from '../../../ui/notifications/notification-preferences-form';
import { NotificationPresentationForm } from '../../../ui/notifications/notification-presentation-form';
import { WatchHistoryList } from '../../../ui/watch-history/watch-history-list';
import { readOwnRoute } from '../friends/read-route';
import { ownPublicProfileSchema } from '@daisy/protocol/public-profile';
import { GET as readPublicProfileRoute } from '../../api/profile/route';
import { PublicProfileForm } from '../../../ui/settings/preferences/public-profile-form';
import { ProfilePhotoControl } from '../../../ui/settings/preferences/profile-photo-control';
import { StatusForm } from '../../../ui/people/status-form';
import { setStatusAction } from '../people/actions';
import { readChosenStatus } from '../people/read-people';

export const metadata: Metadata = { title: 'Settings' };

/**
 * The member's display name, bio and photo (ADR 0143), through the route a
 * script would call; nothing when it could not be read.
 */
async function publicProfileSection(username: string | null) {
  const profile = await readOwnRoute(
    readPublicProfileRoute,
    '/api/profile',
    ownPublicProfileSchema,
  );
  if (profile === null) return null;
  return (
    <div className="flex flex-col gap-4">
      <ProfilePhotoControl
        name={profile.displayName ?? username ?? 'You'}
        photo={profile.photo}
        photoUploads={profile.photoUploads}
      />
      <PublicProfileForm
        action={savePublicProfileAction}
        displayName={profile.displayName}
        bio={profile.bio}
      />
    </div>
  );
}

/** The member's stored notification choices and their watch history. */
async function audienceSections(userId: string) {
  const { preferences, presentation, history } =
    await requestAudienceSettings(userId);
  return {
    notifications: (
      <>
        <NotificationPresentationForm
          action={saveNotificationPresentationAction}
          presentation={presentation}
        />
        <NotificationPreferencesForm
          action={saveNotificationPreferencesAction}
          choices={preferences}
        />
      </>
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
  const username = claimedUsername(identity);
  // A restricted member may still read and clear what they show (ADR 0143);
  // the route decides, and answers nothing to anyone else.
  const [publicProfile, chosen] = await Promise.all([
    'principal' in identity && identity.principal.kind === 'user'
      ? publicProfileSection(username)
      : null,
    identity.state === 'member' ? readChosenStatus() : null,
  ]);
  return (
    <SettingsPage
      {...('principal' in identity && identity.principal.kind === 'user'
        ? await audienceSections(identity.principal.userId)
        : {})}
      username={username}
      publicProfile={publicProfile}
      status={
        chosen ? <StatusForm action={setStatusAction} chosen={chosen} /> : null
      }
      dataRightsNotices={parseDataRightsQuery(query)}
      analytics={await requestAnalytics()}
      onboarding={
        answers === null
          ? null
          : { answers, editHrefs: answerEditHrefs('/settings', true) }
      }
    />
  );
}
