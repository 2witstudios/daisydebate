import { admitsPrincipalAccess } from '@daisy/auth/authorization';
import type { Database } from '@daisy/db';
import type { MediaNodes } from '@daisy/media';
import type { createMediaWorkerAuthentication } from '@daisy/media/internal';
import type { createRoundMediaOperations } from './operations';
import { createAppError, createRefusal } from '@daisy/errors';
import { admissionRevoked, mediaEnded, mediaRuntime } from './projection';

type Capture = ReturnType<Database['createMediaCaptureOperations']>;
type CaptureScope = Awaited<ReturnType<Capture['verifyMediaWorkerLease']>>;
type AuthenticatedWorker = ReturnType<
  ReturnType<typeof createMediaWorkerAuthentication>['verify']
>;

/** Called only after signed-ingress authentication, never by the human routes. */
export function createMediaWorkerTokenBroker(input: {
  readonly sessions: Database['mediaSessions'];
  readonly capture: Capture;
  readonly media: Omit<MediaNodes, 'urlsFor' | 'probe'>;
  readonly urlsFor: MediaNodes['urlsFor'];
  readonly nextId: () => string;
  readonly deadline: <T>(work: Promise<T>) => Promise<T>;
  /** Told why a worker must retry, so the retried 503s can be read in the log. */
  readonly deferred?: (
    cause: 'room_absent' | 'recovery_unresolved',
    sessionId: string,
  ) => void;
  readonly hold: ReturnType<
    typeof createRoundMediaOperations
  >['holdForCapture'];
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
      await input.capture.verifyMediaWorkerLease(scope, 'recover');
      const read = async () => {
        const state = await input.sessions.readMediaSession({
          roundId: scope.roundId,
          admits: admitsPrincipalAccess,
          buildProjection,
        });
        if (!state || state.session.id !== scope.sessionId)
          throw createAppError('NOT_FOUND');
        // A terminal session has ended for good, whoever holds it: the worker
        // stops and is never relaunched (ISSUE-494, ISSUE-495). Its own
        // message, apart from a write refused during a temporary unsafe window.
        if (state.session.endedAt || mediaEnded(state))
          throw createRefusal(
            'CONFLICT',
            'capture-closed',
            'Capture session has ended',
          );
        return state;
      };
      const issue = async (state: Awaited<ReturnType<typeof read>>) => {
        if (
          !(await input.deadline(input.media.exists(state.session.roomName)))
        ) {
          input.deferred?.('room_absent', scope.sessionId);
          throw createAppError('INFRASTRUCTURE');
        }
        const current = await input.capture.verifyMediaWorkerLease(
          scope,
          'mint',
        );
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
          url: input.urlsFor(state.session.roomName).workerUrl,
          token,
          expiresAt: new Date(
            Date.parse(current.serverNow) + 60_000,
          ).toISOString(),
        };
      };
      // A safe receive-only admission skips the claim to avoid capture starvation.
      // A foreign reconcile already running may still fail and delete this room
      // after issue: the worker observes a connect drop and is relaunched. This
      // race grants no floor and is accepted in exchange for bounded admission.
      const first = await read();
      if (
        !first.session.unsafeAt &&
        !first.unresolved &&
        !admissionRevoked(first)
      )
        return issue(first);
      // An unknown vendor outcome takes the hold, so its own reconcile resolves
      // or cleans it up before this held issue (ISSUE-551).
      const held = await input.hold(scope.sessionId, async () => {
        const state = await read();
        if (state.session.unsafeAt || state.unresolved) {
          input.deferred?.('recovery_unresolved', scope.sessionId);
          throw createAppError(
            'INFRASTRUCTURE',
            'Media recovery is unresolved',
          );
        }
        return issue(state);
      });
      if (held) return held.value;
      // The reconcile refused or cleaned up and never reached the issue: a
      // definite end stops the worker; anything else is retried (503).
      await read();
      input.deferred?.('recovery_unresolved', scope.sessionId);
      throw createAppError('INFRASTRUCTURE', 'Media recovery is unresolved');
    },
  };
}
