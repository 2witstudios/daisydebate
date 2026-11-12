import { assert, setupRitewayBun, test } from 'riteway/bun';
import { stubCaseMap } from '@daisy/ai-voice/testing';
import { ballotCategories, ballotRubricVersion } from '@daisy/protocol';
import { claim, harness, reply } from './operations.test-support';
setupRitewayBun();

const ballotJson = JSON.stringify({
  rubricVersion: ballotRubricVersion,
  winner: 'affirmative',
  scores: Object.fromEntries(
    ['affirmative', 'negative'].map((side) => [
      side,
      Object.fromEntries(ballotCategories.map((category) => [category, 3])),
    ]),
  ),
  reason: 'The affirmative thesis is carried.',
  feedback: {},
});
/** Answers each stage's request by the output contract it asks for. */
const byContract = (request: unknown) => {
  const { outputSchema } = request as { outputSchema: { name: string } };
  return Promise.resolve(
    reply(
      outputSchema.name === 'case_map'
        ? JSON.stringify(stubCaseMap)
        : ballotJson,
    ),
  );
};

test('coherency judging buys one stage per claim, in order (ADR 0125)', async () => {
  const sent: { schema: string; user: string }[] = [];
  const { log, job, operations } = harness(async (request) => {
    const { outputSchema, messages } = request as {
      outputSchema: { name: string };
      messages: { role: string; content: string }[];
    };
    sent.push({
      schema: outputSchema.name,
      user: messages.find((message) => message.role === 'user')!.content,
    });
    return byContract(request);
  }, 'first');
  for (let claim3 = 0; claim3 < 3; claim3++)
    await operations
      .executeClaim(claim, new AbortController().signal)
      .catch(() => null);
  assert({
    given: 'a new job claimed three times',
    should:
      'buy the first pass, then the case map, then the final ballot, storing the first two and holding only the final one',
    actual: {
      begun: job.begun,
      stored: job.stored,
      schemas: sent.map((request) => request.schema),
      saved: log.saved,
      provider: log.provider,
    },
    expected: {
      begun: ['first', 'map', 'final'],
      stored: ['first', 'map'],
      schemas: ['ballot', 'case_map', 'ballot'],
      saved: 1,
      provider: 3,
    },
  });
  assert({
    given: 'the final judge’s request',
    should: 'carry the case map and never the first-pass ballot',
    actual: {
      map: sent[2]!.user.includes(stubCaseMap.about.question),
      firstPass: sent[2]!.user.includes('The affirmative thesis is carried.'),
    },
    expected: { map: true, firstPass: false },
  });
});

test('a rejected first pass is recorded and never blocks the final ballot', async () => {
  let call = 0;
  const { log, job, operations } = harness(async (request) => {
    call++;
    return call === 1 ? reply('{"a":1}') : byContract(request);
  }, 'first');
  for (let claim3 = 0; claim3 < 3; claim3++)
    await operations
      .executeClaim(claim, new AbortController().signal)
      .catch(() => null);
  assert({
    given: 'a first pass that fails validation',
    should:
      'record that failure, then still buy the case map and the final ballot',
    actual: {
      failures: log.failures,
      begun: job.begun,
      stored: job.stored,
      saved: log.saved,
    },
    expected: {
      failures: [{ category: 'schema_rejected', final: false }],
      begun: ['first', 'map', 'final'],
      stored: ['map'],
      saved: 1,
    },
  });
});
