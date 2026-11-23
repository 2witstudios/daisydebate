import { readAudienceForViewer } from './audience-snapshot';
import { spectatorClockAt } from './spectator-clock';
import { readWatchRound } from './read-timeline';
import { readUnlessRefused } from './refused-read';
import { requestApp } from '../../lib/page-reads';
import { requestPresentedLink } from '../audience-link/page-reads';

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
          snapshots: requestApp().watchRounds,
          store: requestApp().database,
          publicOrigin: requestApp().config.BROADCAST_PUBLIC_ORIGIN,
        },
        { roundId, presentedHash: await requestPresentedLink(roundId) },
      ),
    'refused' as const,
  );

/** The public Round a Room's link may send anyone to, once its start is released. */
export const requestWatchableRoundOfRoom = (roomId: string) =>
  requestApp().database.readWatchableRoundOfRoom(
    roomId,
    spectatorClockAt(requestApp().clock.now()),
  );

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
        { store: requestApp().database },
        { roundId, actorId, presentedHash },
      ),
    null,
  );
};
