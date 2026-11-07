import {
  acknowledgedReply,
  captureStateReply,
  captureMutationReply,
  sealReply,
  tokenReply,
  canonicalCaptureEvidenceBody,
  evidenceIngressReplySchema,
} from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import { unavailable } from './worker-response';
import {
  createSignedWorkerCall,
  type WorkerTransportDependencies,
} from './worker-transport';
export {
  isCaptureClosedRefusal,
  isDefiniteRefusal,
  isOpenTimelineRefusal,
  isTransientControlFailure,
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
    /** Original native unit only. A historical payload receipt is not publication/hearing permission. */
    async preserve(raw: unknown, signal?: AbortSignal) {
      const original = canonicalCaptureEvidenceBody(raw);
      if (
        original.kind !== 'encoded' ||
        original.body.roundId !== scope.roundId ||
        original.body.sessionId !== scope.sessionId ||
        original.body.workerId !== scope.workerId
      )
        throw createAppError('VALIDATION');
      const reply = (
        await call(
          'evidence',
          original.body,
          evidenceIngressReplySchema,
          signal,
        )
      ).value;
      if (
        reply.kind !== 'refused' &&
        reply.evidenceId !== original.body.evidenceId
      )
        throw unavailable();
      return reply;
    },
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
      stream: Stream & {
        readonly expectedChunkCount: number;
        readonly framesLost: boolean;
      },
      signal?: AbortSignal,
    ) => (await call('seal', stream, sealReply, signal)).value,
    /** Gives up this worker's lease so a successor claims at once; best effort. */
    release: async (epoch: number, signal?: AbortSignal) => {
      await call('release', { epoch }, acknowledgedReply, signal);
    },
    /** Capture hears a bot seat's track (ISSUE-514-r2); the server owns admission. */
    heard: async (
      track: Omit<Stream, 'segmentId'> & {
        /** Null during a countdown, with no segment yet current. */
        readonly segmentId: string | null;
        readonly trackId: string;
      },
      signal?: AbortSignal,
    ) => {
      await call('heard', { ...track, version: 1 }, acknowledgedReply, signal);
    },
  };
}
