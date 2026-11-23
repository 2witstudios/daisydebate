import { readHostNavigation } from './reads/host-navigation';
import { readStandingLobbyManagement } from './reads/standing-lobby-management';
import { leaguePageAddress } from './reads/league-address';
import { readStandingRoomDraft } from './reads/standing-room-draft';
import { authorize } from '@daisy/auth/authorization';
import { readLeagueSeason } from './reads/league-season';
import { readLeagueLadder } from '../ratings/read-league-ladder';
import { appDiscoverActor } from '../account/username-discovery';
import {
  resolveLobbyGrantTarget,
  type LobbyGrantTargetInput,
} from './lobby-grant-target';
import { readLobbyPeople } from './reads/lobby-people';
import { requireSameOrigin } from '../../server/http';
import { headers } from 'next/headers';
import { requestApp, requestIdentity } from '../../lib/page-reads';
import { requestReleaseEnabled } from '../flags/page-reads';

export const requestHostedLeagues = async () => {
  const identity = await requestIdentity();
  if (
    identity.state !== 'member' ||
    !(await requestReleaseEnabled('daisy-tab', identity.principal.userId))
  )
    return [];
  const { principal } = identity;
  const app = requestApp();
  const store = app.database.tabCommands;
  const candidates = await store.hostedLeagueCandidates(principal.userId);
  const read = readHostNavigation({ store, authorize, now: app.clock.now });
  const listed = await Promise.all(
    candidates.map(async (league) => {
      const access = await read(principal, {
        kind: 'organization',
        id: league.id,
      });
      return access ? league : null;
    }),
  );
  return listed.filter((league) => league !== null);
};

export const requestStandingLobbyManagement = async (handle: string) => {
  const identity = await requestIdentity();
  if (
    identity.state !== 'member' ||
    !(await requestReleaseEnabled('daisy-tab', identity.principal.userId))
  )
    return null;
  const app = requestApp();
  const store = app.database.tabCommands;
  const organizationId = await store.organizationIdOfHandle(handle);
  return organizationId
    ? readStandingLobbyManagement(
        { store, authorize, now: app.clock.now() },
        identity.principal,
        organizationId,
      )
    : null;
};

/** Live league page binding with this request's durable principal and account-targeted release gate. */
export const requestLeaguePage = async (
  handle: string,
  input: {
    readonly addressKind: 'standing' | 'organization';
    readonly seasonId?: string | undefined;
    readonly templateId?: string | undefined;
    readonly ladder?:
      | {
          readonly scope: 'top' | 'around';
          readonly search: string;
          readonly page?: number | undefined;
        }
      | undefined;
  },
) => {
  const identity = await requestIdentity();
  if (
    identity.state !== 'member' ||
    !(await requestReleaseEnabled('daisy-tab', identity.principal.userId))
  )
    return null;
  const app = requestApp();
  const store = app.database.tabCommands;
  const address = await leaguePageAddress(store, {
    kind: input.addressKind,
    handle,
  });
  if (!address) return null;
  const organizationId = address.organizationId;
  const principal = identity.principal;
  const season = await readLeagueSeason({ store, authorize })(principal, {
    organizationId,
    ...(address.lobbyId ? { lobbyId: address.lobbyId } : {}),
    ...(input.seasonId ? { seasonId: input.seasonId } : {}),
    ...(input.templateId ? { templateId: input.templateId } : {}),
  });
  if (!season) return null;
  const ladder =
    input.ladder && season.standingLobby
      ? await readLeagueLadder({ store, authorize })(principal, {
          lobbyId: season.standingLobby.id,
          scope: input.ladder.scope,
          search: input.ladder.search,
          ...(input.ladder.page !== undefined
            ? { page: input.ladder.page }
            : {}),
        })
      : null;
  if (input.ladder && !ladder) return null;
  return { season, ladder };
};

/** Native draft addressing uses the actual standing-lobby handle and never depends on a season. */
export const requestStandingRoomPage = async (
  handle: string,
  templateId?: string,
) => {
  const identity = await requestIdentity();
  if (
    identity.state !== 'member' ||
    !(await requestReleaseEnabled('daisy-tab', identity.principal.userId))
  )
    return null;
  const app = requestApp();
  const store = app.database.tabCommands;
  const lobbyId = await store.lobbyIdOfHandle(handle);
  if (!lobbyId) return null;
  return readStandingRoomDraft({ store, authorize, now: app.clock.now })(
    identity.principal,
    { lobbyId, ...(templateId ? { templateId } : {}) },
  );
};

/** A server action's budgeted username resolution, behind its real request boundary. */
export async function requestLobbyGrantTarget(
  input: LobbyGrantTargetInput,
): Promise<string | null> {
  const app = requestApp();
  requireSameOrigin(
    new Request(app.auth().config.PUBLIC_APP_URL, {
      method: 'POST',
      headers: new Headers(await headers()),
    }),
    app.auth().config.PUBLIC_APP_URL,
  );
  const identity = await requestIdentity();
  if (
    identity.state !== 'member' ||
    !(await requestReleaseEnabled('daisy-tab', identity.principal.userId))
  )
    return null;
  return resolveLobbyGrantTarget(identity.principal, input, {
    readPeople: readLobbyPeople({
      store: app.database.tabCommands,
      authorize,
      now: () => app.clock.now(),
    }),
    discover: appDiscoverActor(app),
    userIdOfActor: (actorId) =>
      app.database.getActiveHumanUserIdByActorId(actorId),
  });
}
