import { createAppError, createRefusal } from '@daisy/errors';
import { captureRefusalSchema } from '@daisy/protocol';
import { noopErrorReporter } from '@daisy/observability';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { silentLogger } from '../../server/test-loggers.test-support';
import { createMediaCaptureHandlers } from './handlers';

setupRitewayBun();

const id = (c: string) => c.repeat(24);
const principal = { roundId: id('r'), sessionId: id('s'), workerId: id('w') };
const base = 'http://localhost/internal/media/capture';
const leaseGranted = { epoch: 1, expiresAt: '2026-11-02T12:00:00.000Z' };
const sealed = { state: 'partial', revision: 1 };
const tokenIssued = {
  sessionId: id('s'),
  roomName: id('m'),
  identity: id('i'),
  url: 'wss://media.example.test',
  token: 'media-token',
  expiresAt: '2026-11-02T12:00:00.000Z',
};

const fixture = (
  seal?: () => Promise<unknown>,
  token?: () => Promise<never>,
  lease?: { result: unknown; logged: unknown[] },
) => {
  const calls: [string, unknown][] = [];
  const record =
    (name: string, result: unknown = { ok: name }) =>
    async (payload: unknown) => {
      calls.push([name, payload]);
      return result;
    };
  const handlers = createMediaCaptureHandlers({
    logger: lease
      ? {
          ...silentLogger,
          log: (event: string, fields: unknown) => {
            lease.logged.push([event, fields]);
          },
        }
      : silentLogger,
    reporter: noopErrorReporter,
    authentication: () =>
      ({
        verify: (signed: { signature: string }) => {
          if (signed.signature !== 'valid')
            throw createAppError('AUTHORIZATION');
          return principal;
        },
      }) as never,
    capture: () =>
      ({
        claimMediaWorkerLease: record('lease', lease?.result ?? leaseGranted),
        readMediaCaptureState: record('read'),
        appendCapturedTranscript: record('append'),
        observeCapturedStream: record('observe'),
        sealCapturedStream: seal ?? record('seal', sealed),
      }) as never,
    token: (async (scope: unknown) => {
      if (token) return token();
      calls.push(['token', scope]);
      return tokenIssued;
    }) as never,
    heard: async (identity, body) => {
      calls.push(['heard', { identity, body }]);
    },
  });
  return { handlers, calls };
};
const signed = (operation: string, body: BodyInit, signature = 'valid') =>
  new Request(`${base}/${operation}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-daisy-media-timestamp': '1',
      'x-daisy-media-signature': signature,
    },
    body,
  });

test('a signed capture call dispatches under the authenticated Round scope', async () => {
  const f = fixture();
  const lease = await f.handlers.handle(
    signed('lease', JSON.stringify({ roundId: id('x'), leaseMs: 5000 })),
  );
  const seal = await f.handlers.handle(signed('seal', '{}'));
  assert({
    given: 'a signed lease claiming another Round and a seal',
    should: 'bind the verified Round id over the body and answer each reply',
    actual: [
      lease.status,
      await lease.json(),
      await seal.json(),
      f.calls.map(([name]) => name),
      f.calls[0]![1],
    ],
    expected: [
      200,
      leaseGranted,
      sealed,
      ['lease', 'seal'],
      { roundId: id('r'), leaseMs: 5000 },
    ],
  });
});

test('a reply outside the capture contract is never sent', async () => {
  const f = fixture(async () => ({ state: 'complete', revision: 1, extra: 1 }));
  const response = await f.handlers.handle(signed('seal', '{}'));
  assert({
    given: 'an operation whose answer the worker would refuse',
    should: 'fail here rather than send it',
    actual: response.status,
    expected: 500,
  });
});

test('an inherited object name is refused like any unknown operation', async () => {
  const response = await fixture().handlers.handle(signed('constructor', '{}'));
  assert({
    given: 'a signed call to an operation name every object inherits',
    should: 'be refused rather than fail on it',
    actual: response.status,
    expected: 403,
  });
});

test('a signed token request is validated against its strict scope', async () => {
  const f = fixture();
  const scope = { sessionId: id('s'), workerId: id('w'), epoch: 2 };
  const issued = await f.handlers.handle(
    signed('token', JSON.stringify(scope)),
  );
  const extra = await f.handlers.handle(
    signed('token', JSON.stringify({ ...scope, admin: true })),
  );
  assert({
    given: 'an exact token scope and one with an extra field',
    should: 'issue only for the exact scope bound to the verified Round',
    actual: [await issued.json(), extra.status, f.calls],
    expected: [tokenIssued, 400, [['token', { ...scope, roundId: id('r') }]]],
  });
});

test('signed heard reports reach the heard relay, apart from the worker scope (ISSUE-514-r2)', async () => {
  const f = fixture();
  const scope = { sessionId: id('s'), workerId: id('w'), epoch: 2 };
  const response = await f.handlers.handle(
    signed('heard', JSON.stringify({ ...scope, trackId: 'TR_bot' })),
  );
  assert({
    given: "a signed report that capture hears a bot's track",
    should: 'relay its body under the verified Round scope, answering null',
    actual: [await response.json(), f.calls],
    expected: [
      null,
      [
        [
          'heard',
          {
            identity: { ...scope, roundId: id('r') },
            body: { trackId: 'TR_bot' },
          },
        ],
      ],
    ],
  });
});

test('unsigned, undecodable or unknown capture calls never reach capture', async () => {
  const f = fixture();
  const statuses = await Promise.all(
    [
      signed('lease', '{}', 'forged'),
      signed('lease', new Uint8Array([0xff, 0xfe])),
      signed('delete', '{}'),
    ].map(async (request) => (await f.handlers.handle(request)).status),
  );
  assert({
    given: 'a forged signature, invalid UTF-8 and an unknown operation',
    should: 'refuse each without any capture call',
    actual: { statuses, calls: f.calls.length },
    expected: { statuses: [403, 400, 403], calls: 0 },
  });
});

const refusedWith = (error: unknown) =>
  fixture(async () => {
    throw error;
  }).handlers.handle(signed('seal', '{}'));
const answered = async (error: unknown) => {
  const response = await refusedWith(error);
  return [response.status, (await response.json()).refusal];
};
const REWORDED = 'Any sentence a person may reword';

test('only an open capture timeline is named as a retryable seal refusal', async () => {
  assert({
    given:
      'a seal refused while the timeline is open, and one below stored chunks',
    should:
      'answer 409 for both, naming only the open timeline so the worker retries it (VIDEO-4.1-r1)',
    actual: [
      await answered(createRefusal('CONFLICT', 'timeline-open')),
      await answered(
        createAppError('CONFLICT', 'Capture seal is below stored chunks'),
      ),
    ],
    expected: [
      [409, 'timeline-open'],
      [409, undefined],
    ],
  });
});

test('only a closed capture is named closed for good', async () => {
  assert({
    given:
      'capture closed for good, only temporarily unsafe, on an expired lease, or moved by a takeover',
    should:
      'name closed 409, and the temporary window and a lease its worker may reinstate 503, retried (ISSUE-494-r3), and leave a takeover final',
    actual: [
      await answered(createRefusal('CONFLICT', 'capture-closed')),
      await answered(createRefusal('CONFLICT', 'capture-paused')),
      await answered(createRefusal('CONFLICT', 'lease-expired')),
      await answered(
        createAppError('CONFLICT', 'Capture worker lease is stale'),
      ),
    ],
    expected: [
      [409, 'capture-closed'],
      [503, 'capture-paused'],
      [503, 'lease-expired'],
      [409, undefined],
    ],
  });
});

test('a capture refusal follows its reason, whatever its message says (ISSUE-1010)', async () => {
  assert({
    given: 'every capture refusal, reworded',
    should: 'answer exactly as before',
    actual: await Promise.all(
      captureRefusalSchema.options.map((reason) =>
        answered(createRefusal('CONFLICT', reason, REWORDED)),
      ),
    ),
    expected: [
      [409, 'timeline-open'],
      [409, 'capture-closed'],
      [503, 'capture-paused'],
      [503, 'lease-expired'],
    ],
  });
  assert({
    given: 'an old refusal sentence with no reason',
    should: 'name nothing: the sentence alone means nothing',
    actual: await answered(
      createAppError('CONFLICT', 'Capture session is closed'),
    ),
    expected: [409, undefined],
  });
});

test('a reinstated lease is measured and its reply keeps the worker contract', async () => {
  const lease = {
    result: {
      epoch: 2,
      expiresAt: new Date(15000).toISOString(),
      reinstatedAfterMs: 3200,
    },
    logged: [] as unknown[],
  };
  const response = await fixture(undefined, undefined, lease).handlers.handle(
    signed('lease', '{}'),
  );
  assert({
    given: 'a renewal that reinstated an expired lease',
    should: 'log how long it was expired and answer only epoch and expiry',
    actual: [
      lease.logged.filter(
        (entry) => (entry as string[])[0] === 'media.capture.lease_reinstated',
      ),
      await response.json(),
    ],
    expected: [
      [['media.capture.lease_reinstated', { durationMs: 3200 }]],
      { epoch: 2, expiresAt: new Date(15000).toISOString() },
    ],
  });
});

test('a terminal token refusal ends native capture rather than restarting it', async () => {
  const f = fixture(undefined, async () => {
    throw createRefusal('CONFLICT', 'capture-closed');
  });
  const response = await f.handlers.handle(
    signed(
      'token',
      JSON.stringify({ sessionId: id('s'), workerId: id('w'), epoch: 1 }),
    ),
  );
  const body = await response.json();
  assert({
    given: 'a valid signed token request after the server closed its session',
    should: 'name the definite closure so the supervisor never relaunches it',
    actual: [response.status, body.refusal],
    expected: [409, 'capture-closed'],
  });
});
