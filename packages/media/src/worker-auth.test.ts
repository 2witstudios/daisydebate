import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createMediaWorkerAuthentication } from './worker-auth';

setupRitewayBun();
const roundId = 'r'.repeat(24),
  workerId = 'w'.repeat(24);
const path = `/api/internal/media/${roundId}/capture/token`;
const body = JSON.stringify({ workerId, sessionId: 's'.repeat(24), epoch: 1 });
const instant = Date.parse('2026-10-22T12:00:00.000Z');
const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
  'base64url',
);

test('signed worker principal binds the exact route method body and timestamp', async () => {
  const auth = createMediaWorkerAuthentication({ secret, now: () => instant });
  const headers = auth.sign({ method: 'POST', path, body });
  assert({
    given: 'a valid server-signed worker request',
    should: 'derive only the exact authenticated worker and Round',
    actual: auth.verify({ method: 'POST', path, body, ...headers }),
    expected: { serviceId: `media-capture:${workerId}`, workerId, roundId },
  });
  for (const change of [
    { method: 'GET' },
    { path: path.replace(roundId, 'x'.repeat(24)) },
    { body: body.replace(workerId, 'z'.repeat(24)) },
    { body: `${body} ` },
    { signature: '0'.repeat(64) },
    { signature: 'abc' },
    { timestamp: '2026-10-22T11:59:59.999Z' },
  ])
    await assertRejects({
      given:
        'tampered method, Round, worker, exact body, signature or timestamp',
      should: 'reject authentication without a principal',
      code: 'AUTHORIZATION',
      actual: async () =>
        auth.verify({ method: 'POST', path, body, ...headers, ...change }),
    });
});
test('worker signature admission rejects stale future oversized and ambiguous identity requests', async () => {
  const auth = createMediaWorkerAuthentication({ secret, now: () => instant });
  const headers = auth.sign({ method: 'POST', path, body });
  for (const now of [instant - 5001, instant + 5001])
    await assertRejects({
      given: 'a signature outside the five-second clock window',
      should: 'reject both future and stale admission',
      code: 'AUTHORIZATION',
      actual: async () =>
        createMediaWorkerAuthentication({ secret, now: () => now }).verify({
          method: 'POST',
          path,
          body,
          ...headers,
        }),
    });
  for (const candidate of [
    JSON.stringify({ workerId: 'not-a-cuid2' }),
    JSON.stringify({ workerId, roundId: 'x'.repeat(24) }),
    '['.repeat(128 * 1024 + 1),
  ])
    await assertRejects({
      given: 'invalid worker, foreign Round or oversized raw body',
      should: 'refuse a signed principal',
      code: 'AUTHORIZATION',
      actual: async () => {
        const signed = auth.sign({ method: 'POST', path, body: candidate });
        auth.verify({ method: 'POST', path, body: candidate, ...signed });
      },
    });
  await assertRejects({
    given: 'absent configured shared secret',
    should: 'fail closed at composition',
    code: 'INFRASTRUCTURE',
    actual: async () =>
      createMediaWorkerAuthentication({ secret: '', now: () => instant }),
  });
});
test('every capture operation the worker client calls is admitted, the heard report included (ISSUE-514-r2)', () => {
  const auth = createMediaWorkerAuthentication({ secret, now: () => instant });
  const admitted = (operation: string) => {
    const signedPath = `/api/internal/media/${roundId}/capture/${operation}`;
    const headers = auth.sign({ method: 'POST', path: signedPath, body });
    return auth.verify({ method: 'POST', path: signedPath, body, ...headers })
      .roundId;
  };
  const operations = [
    'token',
    'lease',
    'read',
    'append',
    'observe',
    'seal',
    'activity',
    'heard',
  ];
  assert({
    given: 'a signed call to each capture operation',
    should: 'admit each under the signed Round',
    actual: operations.map(admitted),
    expected: operations.map(() => roundId),
  });
});
