import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { memberGate } from '../round-runtime/member-gate.test-support';
import { createRoundAnalysisHandlers } from './handlers';

setupRitewayBun();
const id = 'a'.repeat(24),
  origin = 'http://localhost:3000';
const post = (body = '', from = origin, accept = 'application/json') =>
  new Request(`${origin}/api/rounds/${id}/round-analysis`, {
    method: 'POST',
    body,
    headers: {
      origin: from,
      accept,
      'content-type': 'application/x-www-form-urlencoded',
    },
  });
const fixture = (refuse = false) => {
  const submitted: unknown[] = [];
  const handlers = createRoundAnalysisHandlers({
    ...memberGate(id, origin),
    request: async (...args) => {
      if (refuse) throw createAppError('CONFLICT');
      submitted.push(args);
    },
    read: async () => ({ status: 'unavailable' }),
  });
  return { handlers, submitted };
};

test('a native analysis form admits the session debater and redirects without a client identity', async () => {
  const f = fixture();
  const response = await f.handlers.requestRoundAnalysis(
    post('', origin, 'text/html'),
    id,
  );
  assert({
    given: 'a native form posting no actor, account or request parameters',
    should: 'use only the authenticated caller and redirect to their Round',
    actual: [
      response.status,
      response.headers.get('location'),
      response.headers.get('cache-control'),
      f.submitted,
    ],
    expected: [
      303,
      `/rounds/${id}#round-analysis`,
      'no-store',
      [[{ userId: id, actorId: id }, id]],
    ],
  });
});

test('analysis request boundaries refuse spoofing, oversized bodies, foreign origins and invalid Round ids', async () => {
  const f = fixture();
  const responses = [];
  for (const [request, roundId] of [
    [post('actorId=other'), id],
    [post('x'.repeat(1025)), id],
    [post('', 'https://foreign.invalid'), id],
    [post(), 'invalid'],
  ] as const)
    responses.push(
      (await f.handlers.requestRoundAnalysis(request, roundId)).status,
    );
  assert({
    given:
      'untrusted authority fields, excess input, a foreign origin and an invalid id',
    should: 'refuse every request before admission',
    actual: [responses, f.submitted],
    expected: [[400, 400, 403, 400], []],
  });
});

test('native analysis refusals return a fixed notice without leaking the reason or submitting work', async () => {
  const f = fixture(true);
  const native = await f.handlers.requestRoundAnalysis(
    post('', origin, 'text/html'),
    id,
  );
  const api = await f.handlers.requestRoundAnalysis(post(), id);
  assert({
    given: 'a refused admission from native HTML and API callers',
    should: 'redirect HTML to the fixed notice and preserve the API refusal',
    actual: [
      native.status,
      native.headers.get('location'),
      api.status,
      f.submitted,
    ],
    expected: [
      303,
      `/rounds/${id}?analysis=analysis-unavailable#round-analysis`,
      409,
      [],
    ],
  });
});
