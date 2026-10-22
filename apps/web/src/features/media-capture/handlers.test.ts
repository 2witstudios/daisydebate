import { createAppError } from '@daisy/errors';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { silentLogger } from '../../server/test-loggers.test-support';
import { createMediaCaptureHandlers } from './handlers';

setupRitewayBun();

const id = (c: string) => c.repeat(24);
const principal = { roundId: id('r'), sessionId: id('s'), workerId: id('w') };
const base = 'http://localhost/internal/media/capture';

const fixture = () => {
  const calls: [string, unknown][] = [];
  const record =
    (name: string, result: unknown = { ok: name }) =>
    async (payload: unknown) => {
      calls.push([name, payload]);
      return result;
    };
  const handlers = createMediaCaptureHandlers({
    logger: silentLogger,
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
        claimMediaWorkerLease: record('lease'),
        readMediaCaptureState: record('read'),
        appendCapturedTranscript: record('append'),
        observeCapturedStream: record('observe'),
        sealCapturedStream: record('seal', null),
      }) as never,
    token: (async (scope: unknown) => {
      calls.push(['token', scope]);
      return { token: 'media-token' };
    }) as never,
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
    given: 'a signed lease claiming another Round and a seal with no result',
    should:
      'bind the verified Round id over the body and answer null for an empty result',
    actual: [
      lease.status,
      await lease.json(),
      await seal.json(),
      f.calls.map(([name]) => name),
      f.calls[0]![1],
    ],
    expected: [
      200,
      { ok: 'lease' },
      null,
      ['lease', 'seal'],
      { roundId: id('r'), leaseMs: 5000 },
    ],
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
    expected: [
      { token: 'media-token' },
      400,
      [['token', { ...scope, roundId: id('r') }]],
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
