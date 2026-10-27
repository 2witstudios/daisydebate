import type { Metadata } from 'next';
import type { SearchParams } from '../../../features/access/decision';
import {
  getPreferences,
  parseSettingsQuery,
} from '../../../features/settings/preferences';
import { requireAccess } from '../../../lib/access';
import { requestIdentity } from '../../../lib/request-session';
import { claimedUsername } from '../../../features/settings/claimed-username';
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
  return (
    <SettingsPage
      username={claimedUsername(await requestIdentity())}
      preferences={getPreferences()}
      saved={parseSettingsQuery(await searchParams)}
      profileAction={saveProfileAction}
      notificationsAction={saveNotificationsAction}
      privacyAction={savePrivacyAction}
    />
  );
}
