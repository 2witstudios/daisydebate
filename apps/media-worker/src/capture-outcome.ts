import { createAppError } from '@daisy/errors';
import { isCaptureConnectionClosed } from '@daisy/media/capture';
import { isCaptureClosedRefusal } from '@daisy/media/worker';
import { tagCaptureFailure, type CaptureFailureStage } from './capture-exit';
import type { CaptureClient } from './capture-history';

export function captureSessionClosed(failure: unknown) {
  if (failure && isCaptureClosedRefusal(failure)) return true;
  if (failure)
    throw createAppError(
      'INFRASTRUCTURE',
      'Capture session ended before safe completion',
      failure,
    );
  return false;
}

/**
 * LiveKit dropped the room: the server's answer says whether the Round closed
 * the capture for good (a refusal the caller finishes on) or the connection
 * failed while the Round still needs capture.
 */
const droppedRoomFailure = (client: CaptureClient, epoch: number) =>
  client.read({ epoch }).then(
    () =>
      tagCaptureFailure(
        'connect',
        createAppError('INFRASTRUCTURE', 'Capture room connection dropped'),
      ),
    (error: unknown) => tagCaptureFailure('connect', error),
  );

/**
 * Which failure ended a capture session (ISSUE-571). The first one wins; a
 * rejection the session's own stop caused is none; a LiveKit drop, seen as
 * `closed` resolving or as a call refused on the closed connection, is
 * judged by the server's answer once the session has stopped.
 */
export function createSessionOutcome(input: {
  readonly caller: AbortSignal;
  readonly stop: AbortController;
  readonly client: CaptureClient;
}) {
  let failure: unknown;
  let roomDropped = false;
  const dropRoom = () => {
    roomDropped = true;
    input.stop.abort();
  };
  const record = (stage: CaptureFailureStage, error: unknown) => {
    failure ??= tagCaptureFailure(stage, error);
  };
  return {
    failure: () => failure,
    record,
    loopFailed(error: unknown) {
      if (!input.caller.aborted && !input.stop.signal.aborted)
        failure ??= error;
    },
    closedAsDrop(error: unknown) {
      if (!isCaptureConnectionClosed(error)) throw error;
      dropRoom();
    },
    watch(closed: Promise<'disconnected' | 'closed'>) {
      void closed.then(
        (reason) => {
          if (reason === 'disconnected') dropRoom();
          input.stop.abort();
        },
        (error: unknown) => {
          record('connect', error);
          input.stop.abort();
        },
      );
    },
    async settle(epoch: number) {
      if (roomDropped && failure === undefined && !input.caller.aborted)
        failure = await droppedRoomFailure(input.client, epoch);
      return failure;
    },
  };
}
