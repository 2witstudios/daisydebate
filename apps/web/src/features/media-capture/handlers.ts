import type { Database } from '@daisy/db';
import type { Logger } from '@daisy/logger';
import type { createMediaWorkerAuthentication } from '@daisy/media/internal';
import { createAppError, isAppError, toPublicError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { z } from 'zod';
import { handleOperation, parseValidated, readBytes } from '../../server/http';
import type { createMediaWorkerTokenBroker } from '../round-media/worker-token';

type Authentication = ReturnType<typeof createMediaWorkerAuthentication>;
type Broker = ReturnType<typeof createMediaWorkerTokenBroker>;
type Capture = ReturnType<Database['createMediaCaptureOperations']>;
const captureScope = z.strictObject({
  roundId: idSchema,
  sessionId: idSchema,
  workerId: idSchema,
  epoch: z.number().int().positive().max(2147483647),
});

/** Private server boundary; human identity and browser request bodies never supply its principal. */
export function createMediaCaptureHandlers(input: {
  readonly logger: Logger;
  readonly authentication: () => Authentication;
  readonly capture: () => Capture;
  readonly token: Broker['captureToken'];
  readonly activity: (
    identity: z.infer<typeof captureScope>,
    body: unknown,
  ) => Promise<void>;
}) {
  return {
    handle: (request: Request) =>
      handleOperation(input.logger, request, 'media.capture', async (id) => {
        const bytes = await readBytes(request, 128 * 1024);
        let body: string;
        try {
          body = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        } catch {
          throw createAppError('VALIDATION');
        }
        const url = new URL(request.url);
        const principal = input.authentication().verify({
          method: request.method,
          path: `${url.pathname}${url.search}`,
          body,
          timestamp: request.headers.get('x-daisy-media-timestamp') ?? '',
          signature: request.headers.get('x-daisy-media-signature') ?? '',
        });
        // Authentication parsed the exact signed JSON object and refused conflicting scope.
        const payload = { ...JSON.parse(body), roundId: principal.roundId };
        const operation = url.pathname.split('/').at(-1);
        if (operation === 'token')
          return Response.json(
            await input.token(parseValidated(captureScope, payload), principal),
          );
        if (operation === 'activity') {
          const { roundId, sessionId, workerId, epoch, ...body } = payload;
          await input.activity(
            parseValidated(captureScope, {
              roundId,
              sessionId,
              workerId,
              epoch,
            }),
            body,
          );
          return Response.json(null);
        }
        const capture = input.capture();
        const operations = {
          lease: capture.claimMediaWorkerLease,
          read: capture.readMediaCaptureState,
          append: capture.appendCapturedTranscript,
          observe: capture.observeCapturedStream,
          seal: capture.sealCapturedStream,
        };
        const dispatch = operations[operation as keyof typeof operations];
        if (!dispatch) throw createAppError('AUTHORIZATION');
        try {
          return Response.json((await dispatch(payload)) ?? null);
        } catch (error) {
          const refusal = namedCaptureRefusal(error, id);
          if (refusal) return refusal;
          throw error;
        }
      }),
  };
}

/**
 * Capture refusals a worker must tell apart, by their internal message: an
 * open timeline is the one seal refusal it may resend (VIDEO-4.1-r1); a closed
 * session or admission ends it for good, never relaunched (ISSUE-494).
 */
const namedRefusals: Readonly<Record<string, string>> = {
  'Capture timeline is still open': 'timeline-open',
  'Capture session is closed': 'capture-closed',
  'Capture admission is closed': 'capture-closed',
};
function namedCaptureRefusal(error: unknown, requestId: string) {
  if (
    !isAppError(error) ||
    error.code !== 'CONFLICT' ||
    !Object.hasOwn(namedRefusals, error.message)
  )
    return null;
  return Response.json(
    {
      ...toPublicError(error, requestId).body,
      refusal: namedRefusals[error.message],
    },
    { status: 409 },
  );
}
