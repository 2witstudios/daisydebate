import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { captureFailureExit, describeCaptureExit } from './capture-exit';
import type { CaptureClient } from './capture-history';
import { runCaptureSession } from './capture-session';
setupRitewayBun();

const refused = async () => Promise.reject(createAppError('CONFLICT'));
const state = { intervals: [], nextIntervalId: null };
const session = (client: Partial<Record<keyof CaptureClient, unknown>>) =>
  runCaptureSession(
    {
      roundId: 'round1',
      client: {
        lease: async () => ({ epoch: 1 }),
        read: async () => ({ state, calibration: {} }),
        ...client,
      } as unknown as CaptureClient,
      voice: { transcribe: async () => '' } as never,
      sttModel: 'model',
      // Every refusal here comes before the room or the consumer is used.
      subscribe: (() => Promise.reject(new Error('unused'))) as never,
      consume: (() => Promise.reject(new Error('unused'))) as never,
      nowMs: () => 0,
      waitUntilMs: async () => {},
    },
    new AbortController().signal,
  ).then(
    () => 'finished',
    (error: unknown) => describeCaptureExit(captureFailureExit(error)),
  );

test('a session refused before it captures reports the stage that refused it', async () => {
  assert({
    given: 'a lease refusal',
    should: 'report the lease stage and its code',
    actual: await session({ lease: refused }),
    expected: { cause: 'lease', errorCode: 'CONFLICT' },
  });
  assert({
    given: 'a refused history read',
    should: 'report the history stage',
    actual: await session({ read: refused }),
    expected: { cause: 'history', errorCode: 'CONFLICT' },
  });
  assert({
    given: 'a refused capture token',
    should: 'report the token stage',
    actual: await session({ token: refused }),
    expected: { cause: 'token', errorCode: 'CONFLICT' },
  });
});
