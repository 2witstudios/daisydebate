import { parseUsername, type Identity } from '@daisy/auth';
import { createAppError } from '@daisy/errors';
import type { Logger } from '@daisy/logger';
import { matchHistoryQuerySchema } from '@daisy/protocol';
import {
  handleOperation,
  parseValidated,
  requireSameOriginRead,
} from '../../server/http';
import { CLIENT_ID_HASH_HEADER } from '../auth/abuse/client-ip';
import { consumeOrThrow, type AuthRateLimiter } from '../auth/abuse/rate-limit';
import { readProfile, type ProfileStore } from './read-profile';

/** Profile reads per member, or per client for a visitor. */
const READ_LIMIT = { max: 120, windowSeconds: 60 } as const;

type Dependencies = {
  readonly logger: Logger;
  readonly origin: () => string;
  readonly identify: (request: Request) => Promise<Identity>;
  readonly limiter: () => AuthRateLimiter;
  readonly store: ProfileStore;
};

/**
 * `GET /api/profiles/:username?before=`: public, so a visitor reads what any
 * other non-owner reads. The owner is the session's user, never a name the
 * request supplies.
 */
export function createProfileHandlers(dependencies: Dependencies) {
  return {
    read: (request: Request, rawUsername: string) =>
      handleOperation(
        dependencies.logger,
        request,
        'profile.read',
        async () => {
          requireSameOriginRead(request, dependencies.origin());
          const username = parseUsername(rawUsername);
          if (!username.ok) throw createAppError('NOT_FOUND');
          const params = new URL(request.url).searchParams;
          if (new Set(params.keys()).size !== [...params.keys()].length)
            throw createAppError('VALIDATION');
          const query = parseValidated(
            matchHistoryQuerySchema,
            Object.fromEntries(params),
          );
          const identity = await dependencies.identify(request);
          // An unreadable session is an outage, never a visitor's view.
          if (identity.state === 'unavailable')
            throw createAppError('INFRASTRUCTURE');
          const viewerUserId =
            identity.state === 'member' ? identity.principal.userId : null;
          await consumeOrThrow(
            dependencies.limiter(),
            `profile:read:${viewerUserId ?? request.headers.get(CLIENT_ID_HASH_HEADER) ?? 'visitor'}`,
            READ_LIMIT,
          );
          const profile = await readProfile(dependencies.store, {
            username: username.username,
            viewerUserId,
            query,
          });
          if (profile === null) throw createAppError('NOT_FOUND');
          return Response.json(profile);
        },
      ),
  };
}
