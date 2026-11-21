import { challengeListSchema } from '@daisy/protocol';
import { GET as readChallengesRoute } from '../../api/challenges/route';
import { readOwnRoute } from '../friends/read-route';

/** The server seed for the member's challenge list. */
export const readChallenges = () =>
  readOwnRoute(
    readChallengesRoute,
    '/api/challenges',
    challengeListSchema.strip(),
  );
