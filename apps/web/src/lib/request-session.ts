import { readAudienceForViewer } from '../features/spectating/audience-snapshot';
import { readNotificationItems } from '../features/notifications/read-notifications';
import { browserCaptureAttributes } from '../features/telemetry/browser-capture';
import { cookies } from 'next/headers';
import { analyticsConfiguration } from '../features/analytics/config';
import { CONSENT_COOKIE, parseConsent } from '../features/analytics/consent';
import { readRoomDraftAnswer } from '../features/rooms/create-room-draft-answer';
import { createAppError } from '@daisy/errors';
import { readLadder } from '../features/leaderboard/read-leaderboard';
import { readMemberStandings } from '../features/ratings/read-member';
import { readRoundRatings } from '../features/ratings/read-round';
import { cache } from 'react';
import { headers } from 'next/headers';
import type { Identity } from '@daisy/auth';
import { admitsOptionalAnswers } from '@daisy/auth/account-age';
import { type MatchHistoryQuery, type MemberProfile } from '@daisy/protocol';
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
import { readProfile } from '../features/profile/read-profile';
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

/**
 * This request's session, resolved once: the root layout and the page it
 * wraps render in the same request, and React's per-request cache makes
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
  return { page, publicCount };
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
 * questions: their canonical age fact admits it (16 or over, ISSUE-645).
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
): Promise<MemberProfile | null> =>
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
export const requestNotifications = (userId: string, unreadOnly: boolean) =>
  readNotificationItems(processApp().database, {
    userId,
    unreadOnly,
    now: processApp().clock.now(),
  });

/** What this account keeps of its notification choices and watching. */
export const requestAudienceSettings = async (userId: string) => {
  const { database, clock } = processApp();
  const [preferences, history] = await Promise.all([
    database.readNotificationPreferences({ userId }),
    database.listWatchHistory({
      userId,
      clock: spectatorClockAt(clock.now()),
      limit: WATCH_HISTORY_ROWS,
    }),
  ]);
  return { preferences, history };
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
  readonly ladder: import('@daisy/protocol').RatingLadder;
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

/** The current published resolutions, Formats' output, read as they stand. */
export const requestPublishedResolutions = () =>
  processApp().database.listPublishedResolutions();

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

export const requestSearchIndexing = () => processApp().config.SEARCH_INDEXING;

/** Native create-room preview answers are scoped to this authenticated member. */
export async function requestRoomDraftAnswer(
  commandId: unknown,
  source: string | null = null,
) {
  const identity = await requestIdentity();
  if (identity.state !== 'member') return { values: {} };
  return readRoomDraftAnswer(
    processApp().redis,
    identity.principal.userId,
    commandId,
    source,
  );
}
