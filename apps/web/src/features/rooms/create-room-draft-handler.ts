import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  handleOperation,
  requireSameOrigin,
  requireSignedIn,
  parseValidated,
} from '../../server/http';
import { consumeOrThrow } from '../../server/rate-limit';
import { readBoundedBody } from '../../server/bounded-body';
import { inProcessFetch } from '../../server/in-process-fetch';
import { readRoomTemplates } from './read-catalog';
import { submitConfiguredRoomCreation } from './create-room-form';
import { saveRoomDraftAnswer } from './create-room-draft-answer';

import type { Identity } from '@daisy/auth';
import type { Logger } from '@daisy/logger';
import type { ErrorReporter } from '@daisy/observability';
import type { RateLimiter } from '../../server/rate-limit';

type Dependencies = {
  readonly logger: Logger;
  /** ADR 0037: where a 5xx from this handler's raw error goes, scrubbed. */
  readonly reporter: ErrorReporter;
  readonly origin: () => string;
  readonly identify: (request: Request) => Promise<Identity>;
  readonly limiter: RateLimiter;
  readonly store: Parameters<typeof saveRoomDraftAnswer>[0];
  readonly catalog: (request: Request) => Promise<Response>;
  readonly create: (request: Request) => Promise<Response>;
  readonly rematch: (request: Request, source: string) => Promise<Response>;
};

/** Full 64-segment schedules need a bounded route, independent of the 16 KiB action cap. */
export function createRoomDraftHandler(dependencies: Dependencies) {
  return async (request: Request) =>
    handleOperation(
      dependencies.logger,
      request,
      'room.draft.submit',
      async () => {
        requireSameOrigin(request, dependencies.origin());
        const identity = requireSignedIn(await dependencies.identify(request));
        if (identity.state !== 'member') throw createAppError('AUTHORIZATION');
        await consumeOrThrow(
          dependencies.limiter,
          `room:draft:${identity.principal.userId}`,
          { max: 60, windowSeconds: 300 },
        );
        const body = await readBoundedBody(request, 128 * 1024);
        if (body === null) throw createAppError('VALIDATION');
        let form: FormData;
        try {
          form = await new Request(request.url, {
            method: 'POST',
            headers: {
              'content-type': request.headers.get('content-type') ?? '',
            },
            body: new Uint8Array(body),
          }).formData();
        } catch {
          throw createAppError('VALIDATION');
        }
        if (form.getAll('sourceRoomId').length > 1)
          throw createAppError('VALIDATION');
        const commandId = parseValidated(idSchema, form.get('commandId'));
        const sourceValue = form.get('sourceRoomId');
        const source = sourceValue
          ? parseValidated(idSchema, sourceValue)
          : null;
        form.delete('sourceRoomId');
        // The same in-process authenticated API owns creation; this header asks moveOn for state.
        const incoming = new Headers(request.headers);
        incoming.set('next-action', 'room-draft');
        const state = await submitConfiguredRoomCreation(
          inProcessFetch(
            source
              ? (request) => dependencies.rematch(request, source)
              : dependencies.create,
            incoming,
          ),
          incoming,
          form,
          await readRoomTemplates(
            inProcessFetch(dependencies.catalog, incoming),
          ),
          source ? `/api/rooms/${source}/rematch` : '/api/rooms',
        );
        if (request.headers.get('accept') === 'application/json')
          return Response.json(state);
        if (state.next)
          return new Response(null, {
            status: 303,
            headers: { location: state.next },
          });
        await saveRoomDraftAnswer(
          dependencies.store,
          identity.principal.userId,
          commandId,
          source,
          state,
        );
        const destination = new URL(
          source ? `/rooms/${source}/rematch` : '/play/room',
          dependencies.origin(),
        );
        destination.searchParams.set('draft', commandId);
        return new Response(null, {
          status: 303,
          headers: { location: `${destination.pathname}${destination.search}` },
        });
      },
      dependencies.reporter,
    );
}
