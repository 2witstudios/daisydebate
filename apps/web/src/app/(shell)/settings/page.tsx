import type { Metadata } from 'next';
import type { SearchParams } from '../../../features/access/decision';
import {
  getPreferences,
  parseSettingsQuery,
} from '../../../features/settings/preferences';
import { requireAccess } from '../../../lib/access';
import {
  requestIdentity,
  requestOnboardingAnswers,
  requestOptionalAnswersAdmitted,
} from '../../../lib/request-session';
import { answerEditHrefs } from '../../../ui/onboarding/answer-summary/answer-summary';
import { SettingsPage } from '../../../ui/settings/preferences/settings-page';
import {
  saveNotificationsAction,
  savePrivacyAction,
  saveProfileAction,
} from './actions';

export const metadata: Metadata = { title: 'Settings' };

export default async function SettingsRoute({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/settings', searchParams);
  const identity = await requestIdentity();
  // ISSUE-324: optional answers only where they are asked (16+, ISSUE-645).
  const answers = (await requestOptionalAnswersAdmitted())
    ? await requestOnboardingAnswers()
    : null;
  return (
    <SettingsPage
      username={identity.state === 'member' ? identity.username : null}
      preferences={getPreferences()}
      saved={parseSettingsQuery(await searchParams)}
      profileAction={saveProfileAction}
      notificationsAction={saveNotificationsAction}
      privacyAction={savePrivacyAction}
      onboarding={
        answers === null
          ? null
          : { answers, editHrefs: answerEditHrefs('/settings') }
      }
    />
  );
}
