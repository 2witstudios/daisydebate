import { createAppError } from '@daisy/errors';
import { readLadder } from './read-leaderboard';
import { readUnlessRefused } from '../spectating/refused-read';
import { seasonGlance } from './season';
import { requestApp, requestIdentity } from '../../lib/page-reads';

/** The running season at a glance, for the Seasons note on Home. */
export const requestSeasonGlance = () =>
  readUnlessRefused(
    async () =>
      seasonGlance(
        await requestApp().database.listLadderSeasons(),
        requestApp().clock.now(),
      ),
    null,
  );

/** Process binding for the public ladder and its signed-in blinding context. */
export async function requestLadder(input: {
  readonly seasonId: string | null;
  readonly ladder: import('@daisy/protocol/ladder').Ladder;
  readonly lobbyId?: string;
  readonly now: string;
}) {
  const identity = await requestIdentity();
  if (identity.state === 'unavailable') throw createAppError('INFRASTRUCTURE');
  return readLadder(requestApp().database, {
    ...input,
    username: identity.state === 'member' ? identity.username : null,
    ...(identity.state === 'member'
      ? { viewerActorId: identity.principal.actorId }
      : {}),
  });
}
