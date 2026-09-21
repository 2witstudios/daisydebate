import { describe, test } from 'riteway/bun';
import { setupRitewayBun, assert } from 'riteway/bun';
import { dispatchDocumentationEvent } from './docs-consult';
import {
  baseOptions,
  droppedBody,
  failureOf,
  instant,
  mergeEvent,
  routedFetch,
} from './docs-consult.test-support';

setupRitewayBun();

// A consult whose status arrived but whose body was lost on the way back.
const dispatchDropped = (status: number, roles: readonly string[]) => {
  const { fetchImpl, counts } = routedFetch({
    consult: async () => droppedBody(status),
    roles: () => roles,
  });
  return {
    counts,
    run: dispatchDocumentationEvent(mergeEvent('fix: only technical'), {
      ...baseOptions,
      ...instant,
      fetchImpl,
    }),
  };
};

describe('dispatchDocumentationEvent with a lost response body', async () => {
  test('settles a lost 5xx body by reading the conversation', async () => {
    const outcomes = await dispatchDropped(502, ['user', 'assistant']).run;
    assert({
      given: 'a 502 whose body read fails and an answered conversation',
      should: 'settle it by the conversation instead of escaping as a throw',
      actual: outcomes.map((outcome) => outcome.outcome),
      expected: ['dispatched'],
    });
  });

  test('names a lost 5xx body as the cause when nothing arrived', async () => {
    const message = await failureOf(dispatchDropped(502, []).run);
    assert({
      given: 'a lost 502 body and a conversation that never appears',
      should: 'fail as never reached, naming the body failure and the replay',
      actual: message,
      expected:
        'Documentation Agent consult for technical-docs never reached PageSpace (body dropped). Its receipt, row 2 of Documentation Runs, stays failed; replay with DOC_REPLAY_ATTEMPT=0 DOC_PIPELINES=technical-docs',
    });
  });

  test('keeps a 409 already-dispatched when its body is lost', async () => {
    const { run, counts } = dispatchDropped(409, []);
    const outcomes = await run;
    assert({
      given: 'a 409 refusal whose body read fails',
      should: 'classify it from the status without polling the conversation',
      actual: {
        outcomes: outcomes.map((outcome) => outcome.outcome),
        reads: counts.messages,
      },
      expected: { outcomes: ['already-dispatched'], reads: 0 },
    });
  });

  test('keeps a 2xx dispatched when its body is lost', async () => {
    const { run, counts } = dispatchDropped(200, []);
    const outcomes = await run;
    assert({
      given: 'a 200 whose body read fails',
      should: 'report dispatched from the status without polling',
      actual: {
        outcomes: outcomes.map((outcome) => outcome.outcome),
        reads: counts.messages,
      },
      expected: { outcomes: ['dispatched'], reads: 0 },
    });
  });

  test('refuses a 4xx whose body is lost', async () => {
    const message = await failureOf(dispatchDropped(403, []).run);
    assert({
      given: 'a 403 refusal whose body read fails',
      should: 'fail naming the status, not as never reached',
      actual: message,
      expected:
        'Documentation Agent consult for technical-docs responded 403: ',
    });
  });
});
