import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readJudgeAssignments, readRoundBallot } from './reads';

setupRitewayBun();

const roundId = 'r'.repeat(24);
const answer =
  (status: number, body: unknown = {}) =>
  async () =>
    Response.json(body, { status });
const offline = async (): Promise<Response> => {
  throw new TypeError('offline');
};

test('a ballot read is missing only for a malformed id or a 404', async () => {
  const requested: string[] = [];
  const result = await readRoundBallot(async (url) => {
    requested.push(url);
    return answer(404)();
  }, roundId);
  assert({
    given: 'a 404 from the protected read and a malformed Round id',
    should: 'report missing, never fetching the malformed id',
    actual: [
      result.kind,
      (await readRoundBallot(offline, '../admin')).kind,
      requested,
    ],
    expected: ['missing', 'missing', [`/api/rounds/${roundId}/ballots`]],
  });
});

test('a ballot read fails closed on errors, foreign shapes and transport loss', async () => {
  assert({
    given: 'a server error, an unparseable body and a lost connection',
    should: 'report the ballot unavailable',
    actual: await Promise.all(
      [answer(503), answer(200, { round: { id: roundId } }), offline].map(
        async (fetch) => (await readRoundBallot(fetch, roundId)).kind,
      ),
    ),
    expected: ['unavailable', 'unavailable', 'unavailable'],
  });
});

test('judge assignments parse strictly and fail closed', async () => {
  const assignment = {
    roundId,
    resolution: 'Cities should make transit free',
    status: 'active',
    outcome: null,
    ballotStatus: null,
    freezeRevision: null,
  };
  assert({
    given: 'a valid list, an extra field, a refusal and a lost connection',
    should: 'return only the valid list and otherwise report unavailable',
    actual: await Promise.all([
      readJudgeAssignments(answer(200, [assignment])),
      readJudgeAssignments(answer(200, [{ ...assignment, seat: 'x' }])),
      readJudgeAssignments(answer(401)),
      readJudgeAssignments(offline),
    ]),
    expected: [
      { kind: 'found', assignments: [assignment] },
      { kind: 'unavailable' },
      { kind: 'unavailable' },
      { kind: 'unavailable' },
    ],
  });
});
