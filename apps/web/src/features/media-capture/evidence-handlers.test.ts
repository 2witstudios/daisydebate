import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { noopErrorReporter } from '@daisy/observability';
import { createMediaWorkerAuthentication } from '@daisy/media/internal';
import { createFrameClock } from '@daisy/media/observation';
import { necessaryEvidencePolicy } from '@daisy/protocol';
import { silentLogger } from '../../server/test-loggers.test-support';
import { createMediaCaptureHandlers } from './handlers';
setupRitewayBun();
const id = (c: string) => c.repeat(24);
const clock = createFrameClock({
  sentAtMs: 0,
  receivedAtMs: 0,
  serverNowMs: 1000,
  precisionMs: 0,
});
clock.observe({ sequence: 0, beforeMs: 10, afterMs: 10 });
const proof = clock.evidence()!;
const body = {
  version: 1,
  evidenceId: id('a'),
  roundId: id('r'),
  sessionId: id('s'),
  workerId: id('w'),
  epoch: 1,
  segmentId: id('g'),
  roundParticipantId: id('p'),
  trackId: 'native-track',
  intervalId: id('i'),
  historyVersion: 1,
  historyReadAt: new Date(2000).toISOString(),
  segmentStartedAtMs: 0,
  startOffsetMs: 1000,
  durationMs: 10,
  before: new Date(Math.floor(proof.window.beforeMs)).toISOString(),
  after: new Date(Math.ceil(proof.window.afterMs)).toISOString(),
  frames: [{ pcmS16le: Buffer.alloc(320).toString('base64'), clock: proof }],
};
const receipt = {
  kind: 'received' as const,
  evidenceId: body.evidenceId,
  bindingDigest: 'b'.repeat(64),
  payloadAcceptedAt: new Date(2000).toISOString(),
  receipt: {
    evidenceId: body.evidenceId,
    bindingDigest: 'b'.repeat(64),
    authorityId: id('c'),
    receivedAtMs: 1000,
    expiresAtMs: 1000 + necessaryEvidencePolicy.maxAgeMs,
  },
};
const authentication = createMediaWorkerAuthentication({
  secret: Buffer.alloc(32, 7).toString('base64url'),
  now: () => 1000,
});
function request(payload: unknown) {
  const path = `/api/internal/media/${body.roundId}/capture/evidence`,
    json = JSON.stringify(payload),
    signed = authentication.sign({ method: 'POST', path, body: json });
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    body: json,
    headers: {
      'content-type': 'application/json',
      'x-daisy-media-timestamp': signed.timestamp,
      'x-daisy-media-signature': signed.signature,
    },
  });
}
function base() {
  return {
    logger: silentLogger,
    reporter: noopErrorReporter,
    authentication: () => authentication,
    capture: () => ({}) as never,
    token: async () => {
      throw createAppError('AUTHORIZATION');
    },
    heard: async () => {},
  };
}
test('signed original evidence dispatches only to the explicit application capability', async () => {
  const received: unknown[] = [];
  const handlers = createMediaCaptureHandlers({
    ...base(),
    evidence: async (raw) => {
      received.push(raw);
      return receipt;
    },
  });
  const response = await handlers.handle(request(body));
  assert({
    given:
      'an actual HMAC-authenticated original frame unit and an explicit injected evidence port (this unit port is not storage proof)',
    should:
      'pass the unchanged canonical body and return only the validated historical payload receipt',
    actual: { status: response.status, reply: await response.json(), received },
    expected: { status: 200, reply: receipt, received: [body] },
  });
});
test('missing evidence capability refuses before any custody or payload work', async () => {
  const response = await createMediaCaptureHandlers(base()).handle(
    request(body),
  );
  assert({
    given:
      'a signed frame unit but no configured evidence application capability',
    should:
      'fail closed as unavailable without activating local or production custody',
    actual: response.status,
    expected: 503,
  });
});
test('malformed or foreign original evidence never reaches the injected capability', async () => {
  let calls = 0;
  const handlers = createMediaCaptureHandlers({
    ...base(),
    evidence: async () => {
      calls++;
      return receipt;
    },
  });
  const malformed = await handlers.handle(request({ ...body, heard: true }));
  const badSignature = request(body);
  badSignature.headers.set('x-daisy-media-signature', '0'.repeat(64));
  const foreign = await handlers.handle(badSignature);
  assert({
    given: 'extra fabricated hearing metadata or a bad request signature',
    should: 'refuse before any evidence side effect',
    actual: { statuses: [malformed.status, foreign.status], calls },
    expected: { statuses: [400, 403], calls: 0 },
  });
});
