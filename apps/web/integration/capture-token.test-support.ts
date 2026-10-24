import { createMediaWorkerAuthentication } from '@daisy/media/internal';
import { createMediaWorkerTokenBroker } from '../src/features/round-media/worker-token';
import {
  captureOperations,
  mediaDependencies,
  type withMediaRound,
} from './round-media.test-support';

/** The actual capture token broker over the fixture's store, vendor and reconcile hold. */
export function captureTokenBroker(
  f: Parameters<Parameters<typeof withMediaRound>[0]>[0],
) {
  const capture = captureOperations(f);
  const deps = mediaDependencies(f, f.media);
  return {
    capture,
    broker: createMediaWorkerTokenBroker({
      sessions: deps.store,
      capture,
      media: deps.media,
      workerUrl: deps.workerUrl,
      nextId: deps.nextId,
      deadline: deps.deadline,
      hold: f.mediaOperations.holdForCapture,
    }),
  };
}

/** The actual capture token broker and a worker principal signed for `scope`. */
export function signedCaptureBroker(
  f: Parameters<Parameters<typeof withMediaRound>[0]>[0],
  scope: {
    readonly sessionId: string;
    readonly workerId: string;
    readonly epoch: number;
  },
) {
  const { capture, broker } = captureTokenBroker(f);
  const auth = createMediaWorkerAuthentication({
    secret: Buffer.alloc(32, 5).toString('base64url'),
    now: () => 1000,
  });
  const request = {
    method: 'POST',
    path: `/api/internal/media/${f.roundId}/capture/token`,
    body: JSON.stringify({
      sessionId: scope.sessionId,
      workerId: scope.workerId,
      epoch: scope.epoch,
    }),
  };
  return {
    capture,
    broker,
    principal: auth.verify({ ...request, ...auth.sign(request) }),
  };
}
