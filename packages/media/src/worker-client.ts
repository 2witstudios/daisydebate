import {
  acknowledgedReply,
  captureStateReply,
  captureMutationReply,
  sealReply,
  tokenReply,
} from './worker-replies';
import { unavailable } from './worker-response';
import {
  createSignedWorkerCall,
  type WorkerTransportDependencies,
} from './worker-transport';
export {
  isCaptureClosedRefusal,
  isDefiniteRefusal,
  isOpenTimelineRefusal,
} from './worker-response';

type Stream = {
  readonly epoch: number;
  readonly segmentId: string;
  readonly roundParticipantId: string;
};

/** Capture's signed client: only capture's own routes. */
export function createMediaWorkerClient(input: WorkerTransportDependencies) {
  const { scope, call, lease, calibratedRead } = createSignedWorkerCall(input);
  return {
    lease,
    read: (
      request: {
        readonly epoch: number;
        readonly segmentId?: string;
        readonly expectedVersion?: number;
        readonly afterIntervalId?: string;
      },
      signal?: AbortSignal,
    ) => calibratedRead(request, captureStateReply, signal),
    async token(epoch: number, signal?: AbortSignal) {
      const reply = (await call('token', { epoch }, tokenReply, signal)).value;
      if (
        reply.sessionId !== scope.sessionId ||
        !['ws:', 'wss:'].includes(new URL(reply.url).protocol)
      )
        throw unavailable();
      return reply;
    },
    append: async (
      clip: Stream & {
        readonly trackId: string;
        readonly startOffsetMs: number;
        readonly durationMs: number;
        readonly text: string;
        readonly before: string;
        readonly after: string;
      },
      signal?: AbortSignal,
    ) => (await call('append', clip, captureMutationReply, signal)).value,
    observe: async (
      observation: Stream & {
        readonly trackId: string;
        readonly observedFrom: string;
        readonly observedUntil: string;
      },
      signal?: AbortSignal,
    ) =>
      (await call('observe', observation, captureMutationReply, signal)).value,
    seal: async (
      stream: Stream & { readonly expectedChunkCount: number },
      signal?: AbortSignal,
    ) => (await call('seal', stream, sealReply, signal)).value,
    /** Capture hears a bot seat's track (ISSUE-514-r2); the server owns admission. */
    heard: async (
      track: Stream & { readonly trackId: string },
      signal?: AbortSignal,
    ) => {
      await call('heard', { ...track, version: 1 }, acknowledgedReply, signal);
    },
  };
}
