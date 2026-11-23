import { createAppError } from '@daisy/errors';
import type { TabStore } from '@daisy/db/tab';
import type { MemberBoundary } from '../auth/member-boundary';
import { bindTabRead } from './read-route';
import {
  directoryPageSchema,
  participantPageQuery,
  postingPageSchema,
  resultsPageSchema,
  tournamentPageSchema,
} from './participant-page-read';
import {
  readParticipantTournament,
  readPublicTournamentPosting,
  readTournamentDirectory,
} from './reads/participant-tournament';
import { readParticipantResults } from './reads/participant-results';

export const createParticipantPageRoute = ({
  boundary,
  store,
  released,
  watchable,
}: {
  readonly boundary: MemberBoundary;
  readonly store: TabStore;
  readonly released: (userId: string | null) => Promise<boolean>;
  readonly watchable?: (request: Request, roomId: string) => Promise<boolean>;
}) =>
  bindTabRead({
    name: 'tab.participant.read',
    access: 'public-posting',
    boundary,
    released,
    query: participantPageQuery,
    read: async (principal, query, request) => {
      if (!principal && query.view !== 'posting')
        throw createAppError('NOT_FOUND');
      if (query.view === 'directory' && principal) {
        const directory = await readTournamentDirectory(
          store,
          principal,
          query.after,
        );
        return directoryPageSchema.parse(directory);
      }
      if (query.view === 'directory') throw createAppError('NOT_FOUND');
      const lobbyId = await store.lobbyIdOfHandle(query.handle);
      if (!lobbyId) throw createAppError('NOT_FOUND');
      const canWatch = watchable?.bind(null, request);
      if (query.view === 'posting') {
        const round = { eventId: query.eventId, roundId: query.roundId };
        const posting = principal
          ? await readParticipantTournament(
              store,
              principal,
              lobbyId,
              round,
              canWatch,
            )
          : await readPublicTournamentPosting(store, { lobbyId, ...round });
        if (!posting?.selected) throw createAppError('NOT_FOUND');
        return postingPageSchema.parse(posting);
      }
      if (!principal) throw createAppError('NOT_FOUND');
      if (query.view === 'tournament') {
        const tournament = await readParticipantTournament(
          store,
          principal,
          lobbyId,
          null,
        );
        if (!tournament) throw createAppError('NOT_FOUND');
        return tournamentPageSchema.parse(tournament);
      }
      const results = await readParticipantResults(
        store,
        principal,
        { lobbyId, eventId: query.eventId },
        query.section,
        canWatch,
      );
      if (!results) throw createAppError('NOT_FOUND');
      return resultsPageSchema.parse(results);
    },
  });
