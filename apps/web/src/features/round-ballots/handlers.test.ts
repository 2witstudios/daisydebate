import { assert, setupRitewayBun, test } from 'riteway/bun';
import { memberGate } from '../round-runtime/member-gate.test-support';
import { ballotFormFixture } from './ballot-form.test-support';
import { ballotFields } from './fields';
import { createRoundBallotHandlers } from './handlers';

setupRitewayBun();

const id = 'a'.repeat(24),
  origin = 'http://localhost:3000';
const parsed = ballotFields(ballotFormFixture());
if (!parsed.ok) throw new Error('The ballot form fixture must parse');
const receipt = { commandId: id, roundId: id, outcome: null };

const fixture = () => {
  const submitted: unknown[] = [];
  const handlers = createRoundBallotHandlers({
    ...memberGate(id, origin),
    operations: {
      submit: async (...args) => {
        submitted.push(args);
        return receipt as never;
      },
    },
    read: async (_caller, roundId) => ({ roundId }) as never,
    assignments: async (caller) => [caller.actorId] as never,
  });
  return { handlers, submitted };
};
const post = (type: string, body: string, from = origin) =>
  new Request(`${origin}/api/rounds/${id}/ballots`, {
    method: 'POST',
    headers: { origin: from, 'content-type': type },
    body,
  });

test('a JSON ballot submits as the session judge and returns its receipt', async () => {
  const f = fixture();
  const response = await f.handlers.submitBallot(
    post('application/json', JSON.stringify(parsed.envelope)),
    id,
  );
  assert({
    given: 'a member posting a strict ballot envelope',
    should: 'submit it under their own actor and return the receipt',
    actual: [response.status, await response.json(), f.submitted],
    expected: [
      200,
      { receipt },
      [[{ kind: 'human', actorId: id }, id, parsed.envelope]],
    ],
  });
});

test('a native ballot form redirects to the ballot page', async () => {
  const f = fixture();
  const response = await f.handlers.submitBallot(
    post(
      'application/x-www-form-urlencoded',
      new URLSearchParams(
        [...ballotFormFixture().entries()].map(([k, v]) => [k, String(v)]),
      ).toString(),
    ),
    id,
  );
  assert({
    given: 'the no-JavaScript ballot form',
    should: 'submit once and redirect without echoing values',
    actual: [
      response.status,
      response.headers.get('location'),
      f.submitted.length,
    ],
    expected: [303, `/judge/ballot/${id}`, 1],
  });
});

test('ballot routes refuse foreign origins and malformed Round ids before work', async () => {
  const f = fixture();
  const statuses = [
    (
      await f.handlers.submitBallot(
        post(
          'application/json',
          JSON.stringify(parsed.envelope),
          'https://foreign.invalid',
        ),
        id,
      )
    ).status,
    (
      await f.handlers.getBallots(
        new Request(`${origin}/api/rounds/x/ballots`),
        'not-an-id',
      )
    ).status,
  ];
  assert({
    given: 'a cross-origin submission and a malformed Round id read',
    should: 'refuse both without submitting',
    actual: { statuses, submitted: f.submitted.length },
    expected: { statuses: [403, 400], submitted: 0 },
  });
});

test('ballot reads answer for the session caller', async () => {
  const f = fixture();
  const read = await f.handlers.getBallots(
    new Request(`${origin}/api/rounds/${id}/ballots`),
    id,
  );
  const assignments = await f.handlers.judgeAssignments(
    new Request(`${origin}/api/judge/assignments`),
  );
  assert({
    given: 'a member reading a Round ballot and their assignments',
    should: 'return the scoped read and the caller-bound list',
    actual: [await read.json(), await assignments.json()],
    expected: [{ roundId: id }, [id]],
  });
});
