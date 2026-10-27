import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import { createMediaWorkerClient } from '@daisy/media/worker';
import { createMediaWorkerAuthentication } from '@daisy/media/internal';
import { readCaptureHistory, type CaptureClient } from './capture-history';
setupRitewayBun();

test('a history deadline restarts acquisition without mixing partial snapshot pages', async () => {
  const deadline = new AbortController();
  const requests: unknown[] = [];
  const oldInterval = {
    id: 'old',
    roundParticipantId: 'seat',
    startedAt: new Date(0).toISOString(),
    endedAt: null,
    startedVersion: 1,
    endedVersion: null,
  };
  const freshInterval = { ...oldInterval, id: 'fresh' };
  let count = 0;
  const client: Pick<CaptureClient, 'read'> = {
    read: async (request: unknown) => {
      requests.push(request);
      count++;
      if (count === 2) {
        deadline.abort();
        throw createAppError('CONFLICT', 'Media control was cancelled');
      }
      return {
        state: {
          roundId: 'round',
          sessionId: 'session',
          status: 'active',
          serverNow: new Date(0).toISOString(),
          transcriptAdmissionCutoff: null,
          participants: [],
          version: count === 1 ? 1 : 2,
          segment: {
            id: 'segment',
            sequence: 0,
            type: 'speech',
            startedAt: new Date(0).toISOString(),
            endedAt: null,
            durationMs: 60000,
          },
          intervals: [count === 1 ? oldInterval : freshInterval],
          nextIntervalId: count === 1 ? 'next' : null,
        },
        calibration: {
          sentAtMs: 0,
          receivedAtMs: 0,
          serverNowMs: 0,
          precisionMs: 1,
        },
      };
    },
  };
  let attempts = 0;
  const result = await readCaptureHistory(
    client,
    1,
    new AbortController().signal,
    undefined,
    {
      deadlineSignal: () =>
        ++attempts === 1 ? deadline.signal : new AbortController().signal,
    },
  );
  assert({
    given: 'a paged history acquisition that exceeds its own deadline',
    should: 'retry from page one and retain only one complete fresh snapshot',
    actual: {
      requests,
      intervals: result.state.intervals,
      version: result.state.version,
    },
    expected: {
      requests: [
        { epoch: 1 },
        {
          epoch: 1,
          segmentId: 'segment',
          expectedVersion: 1,
          afterIntervalId: 'next',
        },
        { epoch: 1 },
      ],
      intervals: [freshInterval],
      version: 2,
    },
  });
});

test('caller cancellation never becomes permission to reacquire history', async () => {
  const stop = new AbortController();
  stop.abort(createAppError('CONFLICT'));
  let calls = 0;
  const client: Pick<CaptureClient, 'read'> = {
    read: async () => {
      calls++;
      throw createAppError('INTERNAL');
    },
  };
  await assertRejects({
    given: 'capture already stopped by its caller',
    should: 'propagate cancellation without reading or retrying',
    actual: () => readCaptureHistory(client, 1, stop.signal),
    code: 'CONFLICT',
  });
  assert({
    given: 'that cancelled acquisition',
    should: 'make zero requests',
    actual: calls,
    expected: 0,
  });
});

test('a definite server refusal wins even if the history deadline also elapsed', async () => {
  const native = createMediaWorkerClient({
    scope: {
      roundId: 'r'.repeat(24),
      sessionId: 's'.repeat(24),
      workerId: 'w'.repeat(24),
    },
    url: 'http://127.0.0.1/',
    authentication: createMediaWorkerAuthentication({
      secret: Buffer.alloc(32, 7).toString('base64url'),
      now: () => 1000,
    }),
    fetch: async () => new Response(null, { status: 403 }),
    nowMs: () => 0,
    deadlineSignal: () => new AbortController().signal,
  });
  const refusal: unknown = await native.read({ epoch: 1 }).then(
    () => {
      throw Error('expected actual refusal');
    },
    (error) => error,
  );
  const deadline = new AbortController();
  let calls = 0;
  const client: Pick<CaptureClient, 'read'> = {
    read: async () => {
      calls++;
      deadline.abort();
      throw refusal;
    },
  };
  await assertRejects({
    given:
      'a real definite authorization refusal concurrent with the read deadline',
    should: 'refuse without retrying or relaxing authority',
    actual: () =>
      readCaptureHistory(client, 1, new AbortController().signal, undefined, {
        deadlineSignal: () => deadline.signal,
      }),
    code: 'AUTHORIZATION',
  });
  assert({
    given: 'the definite refusal',
    should: 'never issue a second request',
    actual: calls,
    expected: 1,
  });
});
