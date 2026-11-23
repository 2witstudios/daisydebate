import { defaultStandingLobby } from '@daisy/protocol/lobby/eligibility';
import { standingLobbyLabels } from './standing-lobby-labels';
import { cache } from 'react';
import { requestApp, requestIdentity } from '../../lib/page-reads';

export const requestOfficialStandingLobbies = cache(async () =>
  standingLobbyLabels(
    await requestApp().database.readOfficialStandingLobbies(),
  ),
);

export const requestCompetitionAgeBand = cache(async (lobbyId?: string) => {
  const identity = await requestIdentity();
  return identity.state === 'member' || identity.state === 'provisional'
    ? requestApp().database.readCompetitionAgeBand(
        identity.principal.userId,
        lobbyId,
      )
    : null;
});

export const requestGuardianLobbyIds = cache(async (lobbyId?: string) => {
  const identity = await requestIdentity();
  if (identity.state !== 'member') return [];
  const ageBand = await requestCompetitionAgeBand(lobbyId);
  return ageBand === '13-15' || ageBand === '16-17'
    ? requestApp().database.readGuardianLobbyIds(identity.principal.userId)
    : [];
});

export const requestLandingLobby = cache(async () =>
  defaultStandingLobby(
    await requestOfficialStandingLobbies(),
    await requestCompetitionAgeBand(),
  ),
);
