import { readFamilySettings } from '../features/parental-controls/settings';
import { evaluatedIdentity } from '../server/member-boundary';
import { messageOfferFor } from '../features/messaging/request-offer';
import { leaguePageAddress } from '../features/tab/reads/league-address';
import { readStandingRoomDraft } from '../features/tab/reads/standing-room-draft';
import { authorize } from '@daisy/auth/authorization';
import { readLeagueSeason } from '../features/tab/reads/league-season';
import { readLeagueLadder } from '../features/ratings/read-league-ladder';
import { appDiscoverActor } from '../features/account/username-discovery';
import {
  resolveLobbyGrantTarget,
  type LobbyGrantTargetInput,
} from '../features/tab/lobby-grant-target';
import { readLobbyPeople } from '../features/tab/reads/lobby-people';
import { requireSameOrigin } from '../server/http';
import { channelMessagesWindow } from '@daisy/protocol';
import { readAudienceForViewer } from '../features/spectating/audience-snapshot';
import type { NotificationsQuery } from '../features/notifications/notifications';
import { readNotificationItems } from '../features/notifications/read-notifications';
import { browserCaptureAttributes } from '../features/telemetry/browser-capture';
import { cookies } from 'next/headers';
import { analyticsConfiguration } from '../features/analytics/config';
import { CONSENT_COOKIE, parseConsent } from '../features/analytics/consent';
import { readRoomDraftAnswer } from '../features/rooms/create-room-draft-answer';
import { idle } from '../features/forms/form-state';
import { createAppError } from '@daisy/errors';
import { readLadder } from '../features/leaderboard/read-leaderboard';
import { readMemberStandings } from '../features/ratings/read-member';
import { readSeasonHistory } from '../features/profile/season-history';
import { readRoundRatings } from '../features/ratings/read-round';
import { cache } from 'react';
import { createRequestFlagReader } from '../features/flags/reader';
import { releaseFlagDefault } from '../features/flags/release-default';
import type { ReleaseFlagKey } from '../features/flags/catalogue';

import { headers } from 'next/headers';
import type { Identity } from '@daisy/auth';
import type { PublicProfileCard } from '@daisy/db';
import { admitsOptionalAnswers } from '@daisy/auth/account-age';
import {
  lobbyOf,
  type MatchHistoryQuery,
  type RatingDivision,
} from '@daisy/protocol';
import type { OnboardingAnswers } from '../features/onboarding/answers';
import { CLIENT_ID_HASH_HEADER } from '../features/auth/abuse/client-ip';
import { readViewerAnalytics } from '../features/analytics/viewer-analytics';
import { spectatorClockAt } from '../features/spectating/spectator-clock';
import { presentedLinkHash } from '../features/audience-link/audience-link';
import { readHostedAudienceLink } from '../features/audience-link/issue-link';
import { readWatchRound } from '../features/spectating/read-timeline';
import { readUnlessRefused } from '../features/spectating/refused-read';
import { seasonGlance } from '../features/leaderboard/season';
import { followingOf } from '../features/watch/following';
import type { HubCounts } from '../features/watch/hub-counts';
import { liveRoundsOf } from '../features/watch/list-live';
import type { LiveQuery } from '../features/watch/live-query';
import {
  readProfile,
  type ProfileView,
} from '../features/profile/read-profile';
import { sessionRefreshDue } from '../features/auth/sessions/session-policy';
import { processApp } from '../server/process-app';
import { createDocumentOperations } from '../features/documents/document-operations';
import { documentPrincipalOf } from '../features/documents/document-principal';
import { ARCHIVE_PAGE_SIZE } from '../features/recording/archive';
import type { RecordingsQuery } from '../features/recording/archive-query';
import type { RecordingViewer } from '../features/recording/audience';
import { recordingReads } from '../features/recording/composition';
import { openRecordingHistory } from '../features/recording/history';
import { resolveSession } from './identity';
import {
  mediaReleaseSettingsView,
  type MediaReleaseSettingsView,
} from '../features/media-releases/settings-view';
import type { ParentLinkRead } from '@daisy/db';
import type { ReleaseLinkPurpose } from '@daisy/protocol/media-release';
import {
  isReleaseLinkToken,
  releaseLinkDigest,
} from '../features/media-releases/link-token';

const requestFlagReader = cache(() => {
  const app = processApp();
  return createRequestFlagReader({
    read: (accountId, keys) => app.database.readFlagSnapshot(accountId, keys),
    now: () => Date.parse(app.clock.now()),
    diagnostic: () =>
      app.logger.log(
        'flags.read.failed',
        { operation: 'flags.read', cause: 'unavailable' },
        'Release control read failed',
      ),
    releaseDefault: releaseFlagDefault(app.config),
  });
});

/** One subject snapshot per render request; anonymous resolution has no targeting. */
export const requestReleaseEnabled = (
  key: ReleaseFlagKey,
  accountId: string | null,
) => requestFlagReader()(key, accountId);
/**
 * This request's session, resolved once: the layouts and the page they
 * wrap render in the same request, and React's per-request cache makes
 * them share one durable session read.
 */
const requestSession = cache(async () =>
  resolveSession(processApp().auth(), await headers()),
);

/**
 * Whether this app offers private-group creation, invitation and
 * admission: never in beta (ISSUE-643), only under an isolated test
 * composition. Pages omit those controls when it does not.
 */
export const privateGroupsOffered = (): boolean =>
  processApp().messagingPolicy.privateGroups === 'isolated-test-fixture';

/** The latest page a conversation reads: the live window, within this policy's page. */
export const messagingLatestPageItems = (): number =>
  Math.min(
    channelMessagesWindow.limit,
    processApp().messagingPolicy.bounds.pageItems,
  );

/** One archive page for this viewer, and how many Recordings are public. */
export const readRecordingArchive = async (
  query: RecordingsQuery,
  viewer: RecordingViewer,
) => {
  const app = processApp();
  const { archive } = recordingReads(app);
  const clock = spectatorClockAt(app.clock.now());
  const [page, publicCount] = await Promise.all([
    archive.listArchive({
      query,
      viewerActorId: viewer.kind === 'account' ? viewer.actorId : null,
      clock,
      limit: ARCHIVE_PAGE_SIZE,
    }),
    archive.countPublicArchive({ clock }),
  ]);
  return { page, publicCount, nowMs: Date.parse(app.clock.now()) };
};

/** A finished Round's history screen for this viewer. */
export const readRecordingHistory = (
  input: Parameters<typeof openRecordingHistory>[1],
) => openRecordingHistory(recordingReads(processApp()).inputs, input);

/** When this account's suspension ends; null for a ban or nothing in force. */
export const requestRestrictionEnd = (userId: string) => {
  const app = processApp();
  return app.database.readRestrictionEnd({ userId, now: app.clock.now() });
};

/** The member's own drive as a server page reads it; null for anyone else. */
export const requestMemberDrive = (identity: Identity) => {
  const principal = documentPrincipalOf(identity);
  if (principal === null) return null;
  const app = processApp();
  return {
    principal,
    operations: createDocumentOperations({
      store: app.database,
      clock: app.clock,
      ids: app.ids,
    }),
  };
};

/** This process clock's instant, for a render that words time. */
export const requestNow = (): string => processApp().clock.now();

/** Who is asking in this server-component render. */
export const requestIdentity = async (): Promise<Identity> =>
  (await requestSession()).identity;

/** Browser capture's attributes for this render's `<html>` (ISSUE-1008). */
export const requestBrowserCapture = () =>
  browserCaptureAttributes(processApp().config);

/** Public adapter config only; management credentials never enter a rendered prop. */
export const requestAnalytics = cache(async () => {
  const app = processApp();
  return readViewerAnalytics({
    config: analyticsConfiguration(app.config),
    identity: await requestIdentity(),
    cookie: parseConsent((await cookies()).get(CONSENT_COOKIE)?.value),
    readConsent: (userId) => app.database.readAnalyticsConsent(userId),
  });
});

/**
 * Whether the browser should slide this request's session now: only for a
 * live signed-in session past `updateAge`, so a signed-in browser calls the
 * rate-limited `get-session` endpoint about once a day, not per page load.
 */
export const sessionRefreshDueNow = async (): Promise<boolean> => {
  const { sessionExpiresAt } = await requestSession();
  return (
    sessionExpiresAt !== null &&
    sessionRefreshDue(sessionExpiresAt, processApp().clock.now())
  );
};

/**
 * The signed-in account's own onboarding answers, read once for this
 * server-component render; null for anyone who cannot onboard: no claimed
 * username, or a restricted account.
 * Waitlisted accounts onboard too (ADR 0075). The id is the session's,
 * never one the request names.
 */
export const requestOnboardingAnswers = cache(
  async (): Promise<OnboardingAnswers | null> => {
    const identity = await requestIdentity();
    if (identity.state !== 'member' && identity.state !== 'waitlisted')
      return null;
    return processApp().database.readOnboarding(identity.principal.userId);
  },
);

/** Whether this render's account without a username has answered the age step. */
export const requestHasRecordedAge = cache(async (): Promise<boolean> => {
  const identity = await requestIdentity();
  if (identity.state !== 'provisional') return false;
  return processApp().database.hasRecordedAge(identity.principal.userId);
});

/**
 * Whether this render's member may be asked the optional onboarding
 * questions: their canonical age fact admits it (13 or over, ISSUE-645, decision 88).
 * False for anyone else; a waitlisted account onboards before approval. A page only skips the questions on it; every
 * answer's write decides again under the account fence.
 */
export const requestOptionalAnswersAdmitted = cache(
  async (): Promise<boolean> => {
    const identity = await requestIdentity();
    // A waitlisted account onboards before approval (ADR 0075).
    if (identity.state !== 'member' && identity.state !== 'waitlisted')
      return false;
    const app = processApp();
    return app.database.optionalAnswersAdmitted({
      userId: identity.principal.userId,
      actorId: identity.principal.actorId,
      now: app.clock.now(),
      admits: admitsOptionalAnswers,
    });
  },
);

/** The ladder division this render's account is on when it is in `state`; null otherwise or without a valid age record. */
const divisionWhen = async (
  state: 'member' | 'provisional',
): Promise<RatingDivision | null> => {
  const identity = await requestIdentity();
  if (identity.state !== state) return null;
  return processApp().database.readMemberDivision(identity.principal.userId);
};

/**
 * This render's member's ladder division (ADR 0147), so a page names their
 * ladder and offers ranked seats on it. Null for anyone else and for a member
 * with no age record. It only shapes the page: every ranked command decides
 * again under its fence.
 */
export const requestMemberDivision = cache(() => divisionWhen('member'));

/**
 * The ladder division a provisional account's recorded age puts it on, for
 * the landing after the age step (YLS-8): `youth` for 13 to 17. Null for
 * anyone else or without a valid age record; it only shapes the page.
 */
export const requestOnboardingDivision = cache(() =>
  divisionWhen('provisional'),
);

/**
 * Club staff's default lobby for the create form's Lobby choice (ADR 0156):
 * their own lobby; null for everyone else, who sees no choice. The create
 * command decides again under the creator's lock.
 */
export const requestStaffLobby = cache(
  async (): Promise<RatingDivision | null> => {
    const identity = await requestIdentity();
    if (identity.state !== 'member') return null;
    const creator = await processApp().database.readRoomCreatorFact(
      identity.principal.userId,
    );
    return creator.clubStaff ? lobbyOf(creator) : null;
  },
);

/**
 * A member's profile as this render's viewer may see it, read in the server
 * render so a link followed from another site renders instead of meeting an
 * API's cross-site read check. The profile feature owns the read and its
 * authorization and budgets; this process entry supplies the trusted client hash
 * and the shared Redis limiter as well as the app's database.
 */
export const requestMemberProfile = async (
  username: string,
  query: MatchHistoryQuery,
): Promise<ProfileView | null> =>
  readProfile(
    { store: processApp().database, limiter: processApp().limiter },
    {
      clientId: (await headers()).get(CLIENT_ID_HASH_HEADER),
      identity: await requestIdentity(),
      username,
      query,
      now: processApp().clock.now(),
    },
  );

/**
 * The member's own display name and published photo, for the shell's account
 * menu (ADR 0143): the one public read lists use, for one actor.
 */
export const requestOwnProfileCard = async (
  actorId: string,
): Promise<PublicProfileCard> =>
  (await processApp().database.readPublicProfileCards([actorId])).get(
    actorId,
  ) ?? { displayName: null, photoId: null };

/**
 * What the public Round route reads, its one way in: the same facts the
 * anonymous snapshot serves, from the same one read a second. Null when this Round
 * has no audience, `refused` when the audience lane is full.
 */
export const requestWatchRound = async (roundId: string) =>
  readUnlessRefused(
    async () =>
      readWatchRound(
        {
          snapshots: processApp().watchRounds,
          store: processApp().database,
          publicOrigin: processApp().config.BROADCAST_PUBLIC_ORIGIN,
        },
        { roundId, presentedHash: await requestPresentedLink(roundId) },
      ),
    'refused' as const,
  );

/** The public Round a Room's link may send anyone to, once its start is released. */
export const requestWatchableRoundOfRoom = (roomId: string) =>
  processApp().database.readWatchableRoundOfRoom(
    roomId,
    spectatorClockAt(processApp().clock.now()),
  );

/** A Round's link standing, for the member who hosts it; null for anyone else. */
export const requestHostedAudienceLink = async (
  roundId: string,
  identity: Identity,
) =>
  identity.state === 'member'
    ? readHostedAudienceLink(processApp().database, {
        roundId,
        caller: {
          userId: identity.principal.userId,
          actorId: identity.principal.actorId,
        },
      })
    : null;

/** The hash of the audience link this render's browser holds for a Round. */
export const requestPresentedLink = async (roundId: string) =>
  presentedLinkHash((await headers()).get('cookie'), roundId);

/** One page of the real Live listing. */
export const requestLiveListing = (query: LiveQuery) =>
  readUnlessRefused(
    () => processApp().liveReads.listing(query),
    'refused' as const,
  );

/** The newest live Rounds, for the home page. */
export const requestLeadingLive = () =>
  readUnlessRefused(() => processApp().liveReads.leading(), []);

/** The running season at a glance, for the Seasons note on Home. */
export const requestSeasonGlance = () =>
  readUnlessRefused(
    async () =>
      seasonGlance(
        await processApp().database.listLadderSeasons(),
        processApp().clock.now(),
      ),
    null,
  );

/** The live Round of each named debater, for a profile or the Friends list. */
export const requestLiveRoundsOf = (usernames: readonly string[]) =>
  readUnlessRefused(
    () =>
      liveRoundsOf(processApp().database, {
        usernames,
        now: processApp().clock.now(),
      }),
    new Map(),
  );

const FOLLOWING_ROWS = 50;
const RECENTLY_WATCHED_ROWS = 10;

/** The Following tab for one account: who it follows, who is live, what it watched. */
export const requestFollowing = async (userId: string) => {
  const { database, clock } = processApp();
  const now = clock.now();
  const [usernames, history] = await Promise.all([
    database.listFollowedDebaters({
      followerUserId: userId,
      limit: FOLLOWING_ROWS,
    }),
    database.listWatchHistory({
      userId,
      clock: spectatorClockAt(now),
      limit: RECENTLY_WATCHED_ROWS,
    }),
  ]);
  const live = await liveRoundsOf(database, { usernames, now });
  return followingOf({ usernames, live, history });
};

/** The running Youth Rounds a member's students debate in (ADR 0155), for the Lobby's live rows. */
export const requestStudentRoundIds = (member: { readonly userId: string }) =>
  processApp().studentRoundIds(member);

/**
 * "Your students, live" (ADR 0155): the running Youth Rounds the member's
 * students debate in, each read as the member, so only those they may watch
 * appear. Empty for anyone linked to no youth debater.
 */
export const requestStudentsLive = (member: {
  readonly userId: string;
  readonly actorId: string;
}) => processApp().studentsLive(member);

/** The numbers on the Watch tabs. */
export const requestHubCounts = async (): Promise<HubCounts> => {
  const app = processApp();
  const clock = spectatorClockAt(app.clock.now());
  const [live, recordings] = await Promise.all([
    readUnlessRefused(() => app.liveReads.count(), 0),
    recordingReads(app).archive.countPublicArchive({ clock }),
  ]);
  return { live, recordings };
};

const WATCH_HISTORY_ROWS = 50;

/** This account's stored notifications, as its list reads them. */
export const requestNotifications = (
  userId: string,
  query: NotificationsQuery,
) =>
  readNotificationItems(processApp().database, {
    userId,
    query,
    now: processApp().clock.now(),
  });

/** What this account keeps of its notification choices and watching. */
export const requestAudienceSettings = async (userId: string) => {
  const { database, clock } = processApp();
  const [preferences, presentation, history, messageRequestSetting] =
    await Promise.all([
      database.readNotificationPreferences({ userId }),
      database.readNotificationPresentation({ userId }),
      database.listWatchHistory({
        userId,
        clock: spectatorClockAt(clock.now()),
        limit: WATCH_HISTORY_ROWS,
      }),
      database.readMessageRequestSetting({ userId }),
    ]);
  return { preferences, presentation, history, messageRequestSetting };
};

/** Whether this account follows that debater; null when it cannot. */
export const requestDebaterFollow = (
  followerUserId: string,
  username: string,
) => processApp().database.readDebaterFollow({ followerUserId, username });

/**
 * A Round's audience for this viewer, by the same reads as the snapshot. Fresh, so
 * a poster sees their own message. A full lane omits it from this render: it sits
 * beside a debate or a feed and never takes them down.
 */
export const requestAudience = async (
  roundId: string,
  actorId: string | null,
) => {
  const presentedHash = await requestPresentedLink(roundId);
  return readUnlessRefused(
    () =>
      readAudienceForViewer(
        { store: processApp().database },
        { roundId, actorId, presentedHash },
      ),
    null,
  );
};

/** Process binding for the public ladder and its signed-in blinding context. */
export async function requestLadder(input: {
  readonly seasonId: string | null;
  readonly ladder: import('@daisy/protocol').Ladder;
  readonly now: string;
}) {
  const identity = await requestIdentity();
  if (identity.state === 'unavailable') throw createAppError('INFRASTRUCTURE');
  return readLadder(processApp().database, {
    ...input,
    username: identity.state === 'member' ? identity.username : null,
    ...(identity.state === 'member'
      ? { viewerActorId: identity.principal.actorId }
      : {}),
  });
}

export async function requestMemberStandings(username: string) {
  const identity = await requestIdentity();
  if (identity.state === 'unavailable') throw createAppError('INFRASTRUCTURE');
  const app = processApp();
  return readMemberStandings(app.database, {
    username,
    now: app.clock.now(),
    ...(identity.state === 'member'
      ? { viewerActorId: identity.principal.actorId }
      : {}),
  });
}

/** A member's closed seasons per ladder, newest first, for their profile. */
export async function requestSeasonHistory(username: string) {
  const identity = await requestIdentity();
  if (identity.state === 'unavailable') throw createAppError('INFRASTRUCTURE');
  const app = processApp();
  return readSeasonHistory(app.database, {
    username,
    now: app.clock.now(),
    ...(identity.state === 'member'
      ? { viewerActorId: identity.principal.actorId }
      : {}),
  });
}

/** The renderer supplies a Round it already read under its audience policy. */
export async function requestRoundRatings(
  round: import('@daisy/protocol').RoundView,
) {
  const identity = await requestIdentity();
  if (identity.state === 'unavailable') throw createAppError('INFRASTRUCTURE');
  const app = processApp();
  return readRoundRatings(app.database, {
    round,
    now: app.clock.now(),
    viewerActorId:
      identity.state === 'member' ? identity.principal.actorId : null,
  });
}

/** Canonical deployment URL, never derived from a caller-controlled Host. */
export const requestMetadataBase = (): URL =>
  new URL(processApp().config.PUBLIC_APP_URL);

export const requestRealtimeEndpoint = (): string | null =>
  processApp().websocketEndpoint;

export const requestSearchIndexing = () => processApp().config.SEARCH_INDEXING;

/** Native create-room preview answers are scoped to this authenticated member. */
export async function requestRoomDraftAnswer(
  commandId: unknown,
  source: string | null = null,
) {
  const identity = await requestIdentity();
  if (identity.state !== 'member') return idle();
  return readRoomDraftAnswer(
    processApp().redis,
    identity.principal.userId,
    commandId,
    source,
  );
}

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
  const app = processApp();
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
  const app = processApp();
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
  const app = processApp();
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

/**
 * What a presented release link may do, read without changing anything; a
 * value that is not a token's shape is never looked up and reads as unknown.
 */
export const readReleaseLink = async (
  purpose: ReleaseLinkPurpose,
  token: string,
): Promise<ParentLinkRead> =>
  isReleaseLinkToken(token)
    ? processApp().database.mediaReleases.readParentLink(
        releaseLinkDigest(purpose, token),
        purpose,
      )
    : { kind: 'unknown' };

/** The app's clock, for what a release page derives from a link's dates. */
export const releaseNowMs = (): number => Date.parse(processApp().clock.now());

/**
 * A youth member's media release section (ADR 0151), or null: only on Youth –
 * Freestyle.
 */
export const requestMediaReleaseSettings = async (
  userId: string,
): Promise<MediaReleaseSettingsView | null> => {
  const read =
    await processApp().database.mediaReleases.readMinorRelease(userId);
  return read.division === 'youth' ? mediaReleaseSettingsView(read) : null;
};

/** The parental-controls flag gates even the bound birth-month read. */
export async function requestGuardianAgeBinding(userId: string) {
  if (!(await requestReleaseEnabled('parental-controls', userId))) return null;
  const { database, clock } = processApp();
  return database.childAccountBinding(userId, clock.now());
}

export const requestFamilyViewer = cache(async () => {
  const identity = await requestIdentity();
  if (!evaluatedIdentity(identity)) return null;
  const { userId } = identity.principal;
  if (!(await requestReleaseEnabled('parental-controls', userId))) return null;
  const { ageBand } =
    await processApp().database.getParticipationByUserId(userId);
  if (ageBand === 'adult') return { userId, role: 'adult' as const };
  if (ageBand === '13-15' || ageBand === '16-17')
    return { userId, role: 'child' as const };
  return null;
});

export async function requestFamilyRows(role: 'adult' | 'child') {
  const viewer = await requestFamilyViewer();
  if (viewer?.role !== role) return null;
  const { database, clock } = processApp();
  return database.guardians.forSubject(viewer.userId, (session) =>
    readFamilySettings(session, viewer.userId, role, new Date(clock.now())),
  );
}

/** What this member's profile view offers toward `username` (decision 90). */
export const requestMessageOffer = async (username: string) => {
  const identity = await requestIdentity();
  return identity.state === 'member'
    ? messageOfferFor(processApp(), identity.principal, username)
    : ('none' as const);
};
