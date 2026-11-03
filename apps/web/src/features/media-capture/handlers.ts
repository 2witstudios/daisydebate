import type { Database } from '@daisy/db';
import type { Logger } from '@daisy/logger';
import type { ErrorReporter } from '@daisy/observability';
import type { createMediaWorkerAuthentication } from '@daisy/media/internal';
import { createAppError, isAppError, toPublicError } from '@daisy/errors';
import {
  acknowledgedReply,
  captureMutationReply,
  captureRefusalSchema,
  captureStateReply,
  idSchema,
  leaseReply,
  sealReply,
  tokenReply,
  type CaptureRefusal,
} from '@daisy/protocol';
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
/** An expendable relay from capture: the server owns its admission. */
type Relay = (
  identity: z.infer<typeof captureScope>,
  body: unknown,
) => Promise<void>;

/** Private server boundary; human identity and browser request bodies never supply its principal. */
export function createMediaCaptureHandlers(input: {
  readonly logger: Logger;
  /** ADR 0037: where a 5xx from this handler's raw error goes, scrubbed. */
  readonly reporter: ErrorReporter;
  readonly authentication: () => Authentication;
  readonly capture: () => Capture;
  readonly token: Broker['captureToken'];
  /** Capture hears a bot seat's track (DEC-226, ISSUE-514-r2). */
  readonly heard: Relay;
}) {
  const relays = new Map([['heard', input.heard]]);
  return {
    handle: (request: Request) =>
      handleOperation(
        input.logger,
        request,
        'media.capture',
        async (id) => {
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
          try {
            if (operation === 'token')
              return Response.json(
                tokenReply.parse(
                  await input.token(
                    parseValidated(captureScope, payload),
                    principal,
                  ),
                ),
              );
            const relay = relays.get(String(operation));
            if (relay) {
              const { roundId, sessionId, workerId, epoch, ...body } = payload;
              await relay(
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
            if (operation === 'lease') {
              const { reinstatedAfterMs, ...lease } =
                await capture.claimMediaWorkerLease(payload);
              if (reinstatedAfterMs !== undefined)
                input.logger.log(
                  'media.capture.lease_reinstated',
                  { durationMs: reinstatedAfterMs },
                  'Capture lease reinstated after an outage',
                );
              return Response.json(leaseReply.parse(lease));
            }
            const operations = {
              release: [capture.releaseMediaWorkerLease, acknowledgedReply],
              read: [capture.readMediaCaptureState, captureStateReply],
              append: [capture.appendCapturedTranscript, captureMutationReply],
              observe: [capture.observeCapturedStream, captureMutationReply],
              seal: [capture.sealCapturedStream, sealReply],
            } as const;
            if (!Object.hasOwn(operations, String(operation)))
              throw createAppError('AUTHORIZATION');
            const route = operations[operation as keyof typeof operations];
            const [dispatch, reply] = route;
            return Response.json(
              reply.parse((await dispatch(payload as never)) ?? null),
            );
          } catch (error) {
            const refusal = namedCaptureRefusal(error, id);
            if (refusal) return refusal;
            throw error;
          }
        },
        input.reporter,
      ),
  };
}

/**
 * The status each capture refusal answers with. An open timeline and a closed
 * capture are answers; a paused capture or an expired lease is refused only
 * for now, so its worker retries.
 */
const captureRefusalStatus: Readonly<Record<CaptureRefusal, 409 | 503>> = {
  'timeline-open': 409,
  'capture-closed': 409,
  'capture-paused': 503,
  'lease-expired': 503,
};
export function namedCaptureRefusal(error: unknown, requestId: string) {
  if (!isAppError(error)) return null;
  const named = captureRefusalSchema.safeParse(error.reason);
  if (!named.success) return null;
  return Response.json(
    { ...toPublicError(error, requestId).body, refusal: named.data },
    { status: captureRefusalStatus[named.data] },
  );
}
