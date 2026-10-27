import { createAppError } from '@daisy/errors';
import { isDefiniteRefusal } from '@daisy/media/worker';
import { atStage, tagCaptureFailure } from './capture-exit';
import type { CaptureClient } from './capture-history';

/** Token requests per session, each under the call's own deadline. */
const CAPTURE_TOKEN_ATTEMPTS = 3;

/**
 * The session's LiveKit token. A request whose outcome is uncertain (its
 * deadline, the network, a 503 that outlasted its retries) is asked for again
 * under a renewed lease, rather than ending the process and leaving its lease
 * to block the relaunch (ISSUE-571); a definite refusal is final. An unused
 * token is harmless: it is hidden, receive-only and expires in 60 s.
 */
export async function issueCaptureToken(
  client: CaptureClient,
  epoch: number,
  signal: AbortSignal,
) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await client.token(epoch, signal);
    } catch (error) {
      if (
        attempt >= CAPTURE_TOKEN_ATTEMPTS ||
        signal.aborted ||
        isDefiniteRefusal(error)
      )
        throw tagCaptureFailure('token', error);
    }
    const renewed = await atStage(
      'renewal',
      client.lease(15000, signal, epoch),
    );
    if (renewed.epoch !== epoch)
      throw tagCaptureFailure(
        'renewal',
        createAppError('CONFLICT', 'Capture epoch changed'),
      );
  }
}
