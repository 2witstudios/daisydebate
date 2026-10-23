import type { Database } from '@daisy/db';
import type { createMediaService } from '@daisy/media';
import type { createMediaWorkerAuthentication } from '@daisy/media/internal';
import { createAppError } from '@daisy/errors';
import { mediaEnded, mediaRuntime } from './projection';

type Capture = ReturnType<Database['createMediaCaptureOperations']>;
type CaptureScope = Awaited<ReturnType<Capture['verifyMediaWorkerLease']>>;
type AuthenticatedWorker = ReturnType<
  ReturnType<typeof createMediaWorkerAuthentication>['verify']
>;

/** Called only after signed-ingress authentication, never by the human routes. */
export function createMediaWorkerTokenBroker(input: {
  readonly sessions: Database['mediaSessions'];
  readonly capture: Capture;
  readonly media: ReturnType<typeof createMediaService>;
  readonly workerUrl: string;
  readonly nextId: () => string;
  readonly deadline: <T>(work: Promise<T>) => Promise<T>;
}) {
  const buildProjection: Parameters<
    Database['mediaSessions']['readMediaSession']
  >[0]['buildProjection'] = (context) =>
    mediaRuntime(context, input.nextId).tick(context.now);
  return {
    async captureToken(
      scope: Pick<CaptureScope, 'roundId' | 'sessionId' | 'workerId' | 'epoch'>,
      authenticated: AuthenticatedWorker,
    ) {
      if (
        authenticated.roundId !== scope.roundId ||
        authenticated.workerId !== scope.workerId ||
        authenticated.serviceId !== `media-capture:${scope.workerId}`
      )
        throw createAppError('AUTHORIZATION');
      await input.capture.verifyMediaWorkerLease(scope);
      const state = await input.sessions.readMediaSession({
        roundId: scope.roundId,
        buildProjection,
      });
      if (!state || state.session.id !== scope.sessionId)
        throw createAppError('NOT_FOUND');
      // A terminal session has ended for good, whoever holds it: the worker
      // stops and is never relaunched (ISSUE-494, ISSUE-495). Its own message,
      // apart from a write refused during a temporary unsafe window.
      if (state.session.endedAt || mediaEnded(state))
        throw createAppError('CONFLICT', 'Capture session has ended');
      // A browser's reconcile holds a live session for well under a second:
      // refused for now (503, which the worker retries), as for human
      // admission, never a definite conflict that ends the worker's epoch.
      if (state.reconciling)
        throw createAppError('INFRASTRUCTURE', 'Media recovery is unresolved');
      if (!(await input.deadline(input.media.exists(state.session.roomName))))
        throw createAppError('INFRASTRUCTURE');
      const current = await input.capture.verifyMediaWorkerLease(scope);
      const identity = input.nextId();
      const token = await input.media.joinToken({
        room: state.session.roomName,
        identity,
        publish: [],
        subscribe: true,
        capture: true,
        hidden: true,
      });
      return {
        sessionId: scope.sessionId,
        roomName: state.session.roomName,
        identity,
        url: input.workerUrl,
        token,
        expiresAt: new Date(
          Date.parse(current.serverNow) + 60_000,
        ).toISOString(),
      };
    },
  };
}
