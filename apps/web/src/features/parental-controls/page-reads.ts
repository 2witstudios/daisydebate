import { readFamilySettings } from './settings';
import { CONTENT_WAIVER_VERSION } from '../legal/agreements';
import { evaluatedIdentity } from '../../server/member-boundary';
import { cache } from 'react';
import { requestApp, requestIdentity } from '../../lib/page-reads';
import { requestReleaseEnabled } from '../flags/page-reads';

/** The parental-controls flag gates even the bound birth-month read. */
export async function requestGuardianAgeBinding(userId: string) {
  if (!(await requestReleaseEnabled('parental-controls', userId))) return null;
  const { database, clock } = requestApp();
  return database.childAccountBinding(userId, clock.now());
}

export const requestFamilyViewer = cache(async () => {
  const identity = await requestIdentity();
  if (!evaluatedIdentity(identity)) return null;
  const { userId } = identity.principal;
  if (!(await requestReleaseEnabled('parental-controls', userId))) return null;
  const { ageBand } =
    await requestApp().database.getParticipationByUserId(userId);
  if (ageBand === 'adult') return { userId, role: 'adult' as const };
  if (ageBand === '13-15' || ageBand === '16-17')
    return { userId, role: 'child' as const };
  return null;
});

export async function requestFamilyRows(role: 'adult' | 'child') {
  const viewer = await requestFamilyViewer();
  if (!viewer || (role === 'adult' && viewer.role !== 'adult')) return null;
  const lobbyPermissionOnly = viewer.role !== role;
  if (lobbyPermissionOnly && !(await requestFamilyLobbyPermissions('child')))
    return null;
  const { database, clock } = requestApp();
  const rows = await database.guardians.forSubject(viewer.userId, (session) =>
    readFamilySettings(
      session,
      viewer.userId,
      role,
      new Date(clock.now()),
      lobbyPermissionOnly,
    ),
  );
  return { rows, lobbyPermissionOnly };
}

export async function requestFriendApprovals() {
  const viewer = await requestFamilyViewer();
  if (viewer?.role !== 'adult') return [];
  return requestApp().database.guardians.forSubject(viewer.userId, (session) =>
    session.waitingFriendApprovals(),
  );
}

export const requestFamilyLobbyPermissions = cache(
  async (role: 'adult' | 'child') => {
    const viewer = await requestFamilyViewer();
    if (!viewer || (role === 'adult' && viewer.role !== 'adult')) return null;
    const view = await requestApp().database.lobbyPermissions.read(
      viewer.userId,
      CONTENT_WAIVER_VERSION,
      role,
    );
    return viewer.role === role ||
      (view.hasActiveParent && view.choices.length > 0)
      ? view
      : null;
  },
);
