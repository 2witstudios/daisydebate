import {
  directoryPageSchema,
  participantPagePath,
  postingPageSchema,
  resultsPageSchema,
  tournamentPageSchema,
} from '../../../features/tab/participant-page-read';
import { requireTabRelease } from '../../../features/tab/release';
import { readOwnRoute } from '../../(shell)/friends/read-route';
import { GET } from '../../api/tab/participant/route';

export async function storedTournament(handle: string) {
  await requireTabRelease();
  return readOwnRoute(
    GET,
    participantPagePath({ view: 'tournament', handle }),
    tournamentPageSchema,
  );
}

export async function storedDirectory(after: string) {
  await requireTabRelease();
  return readOwnRoute(
    GET,
    participantPagePath({ view: 'directory', after }),
    directoryPageSchema,
  );
}

export async function storedTournamentResults(
  handle: string,
  eventId: string,
  section: 'standings' | 'bracket',
) {
  await requireTabRelease();
  return readOwnRoute(
    GET,
    participantPagePath({ view: 'results', handle, eventId, section }),
    resultsPageSchema,
  );
}

export async function storedTournamentPosting(
  handle: string,
  round: { readonly eventId: string; readonly roundId: string },
) {
  await requireTabRelease();
  return readOwnRoute(
    GET,
    participantPagePath({ view: 'posting', handle, ...round }),
    postingPageSchema,
  );
}
