import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { ballotFormFixture } from './ballot-form.test-support';
import { ballotFields } from './fields';
import { readRoundBallotBody } from './body';

setupRitewayBun();

const form = ballotFormFixture();
const parsed = ballotFields(form);
if (!parsed.ok) throw new Error('The ballot form fixture must parse');
const post = (type: string, body: string) =>
  new Request('http://localhost/api/rounds/r/ballots', {
    method: 'POST',
    headers: { 'content-type': type },
    body,
  });
const encoded = new URLSearchParams(
  [...form.entries()].map(([key, value]) => [key, String(value)]),
).toString();

test('a ballot body is the same envelope from JSON or a native form', async () => {
  assert({
    given: 'the strict JSON envelope and the equivalent urlencoded form',
    should: 'read the same envelope and mark only the form as native',
    actual: [
      await readRoundBallotBody(
        post('application/json', JSON.stringify(parsed.envelope)),
        8192,
      ),
      await readRoundBallotBody(
        post('application/x-www-form-urlencoded; charset=utf-8', encoded),
        8192,
      ),
    ],
    expected: [
      { native: false, envelope: parsed.envelope },
      { native: true, envelope: parsed.envelope },
    ],
  });
});

test('an invalid or oversized ballot body is refused', async () => {
  for (const [label, request] of [
    [
      'a JSON envelope with an extra field',
      post('application/json', JSON.stringify({ ...parsed.envelope, x: 1 })),
    ],
    [
      'a form without its winner',
      post(
        'application/x-www-form-urlencoded',
        encoded.replace(/(^|&)winner=[^&]*/, ''),
      ),
    ],
  ] as const)
    await assertRejects({
      given: label,
      should: 'refuse as invalid',
      actual: () => readRoundBallotBody(request, 8192),
      code: 'VALIDATION',
    });
  await assertRejects({
    given: 'a body beyond the byte limit',
    should: 'refuse before parsing',
    actual: () => readRoundBallotBody(post('application/json', encoded), 16),
    code: 'PAYLOAD_TOO_LARGE',
  });
});
