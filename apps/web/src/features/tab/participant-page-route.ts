import { createAppError } from '@daisy/errors';
import type { TabStore } from '@daisy/db/tab';
import type { MemberBoundary } from '../../server/member-boundary';
import {
  handleOperation,
  parseValidated,
  requireSameOriginRead,
} from '../../server/http';
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

export const createParticipantPageRoute =
  ({
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
  (request: Request) =>
    handleOperation(
      boundary.logger,
      request,
      'tab.participant.read',
      async () => {
        requireSameOriginRead(request, boundary.origin());
        const identity = await boundary.identify(request);
        if (identity.state === 'unavailable')
          throw createAppError('INFRASTRUCTURE');
        if (identity.state !== 'member' && identity.state !== 'anonymous')
          throw createAppError('NOT_FOUND');
        const principal =
          identity.state === 'member' ? identity.principal : null;
        if (!(await released(principal?.userId ?? null)))
          throw createAppError('NOT_FOUND');
        const query = parseValidated(
          participantPageQuery,
          Object.fromEntries(new URL(request.url).searchParams),
        );
        if (!principal && query.view !== 'posting')
          throw createAppError('NOT_FOUND');
        if (query.view === 'directory' && principal) {
          const directory = await readTournamentDirectory(
            store,
            principal,
            query.after,
          );
          return Response.json(directoryPageSchema.parse(directory));
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
          return Response.json(postingPageSchema.parse(posting));
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
          return Response.json(tournamentPageSchema.parse(tournament));
        }
        const results = await readParticipantResults(
          store,
          principal,
          { lobbyId, eventId: query.eventId },
          query.section,
          canWatch,
        );
        if (!results) throw createAppError('NOT_FOUND');
        return Response.json(resultsPageSchema.parse(results));
      },
      boundary.reporter,
    );
