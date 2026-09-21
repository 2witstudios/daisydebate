import { describe, test } from 'riteway/bun';
import { setupRitewayBun, assert } from 'riteway/bun';
import { conversationIdFor, dispatchDocumentationEvent } from './docs-consult';
import {
  baseOptions,
  hangUntilAborted,
  instant,
  mergeEvent,
  ok,
  recordingFetch,
  routedFetch,
} from './docs-consult.test-support';

setupRitewayBun();

describe('dispatchDocumentationEvent', async () => {
  test('consults the agent once per routed pipeline with a bearer token', async () => {
    const { calls, fetchImpl } = recordingFetch(ok);
    const outcomes = await dispatchDocumentationEvent(mergeEvent(), {
      ...baseOptions,
      fetchImpl,
      nonce: () => 'n0nce',
    });
    assert({
      given: 'a merge routed to technical-docs and user-docs',
      should:
        'POST one consult per pipeline to the consult route, authenticated',
      actual: {
        urls: calls.map((call) => call.url),
        auth: calls.map((call) =>
          new Headers(call.init.headers).get('Authorization'),
        ),
        agents: calls.map((call) => call.body.agentId),
        pipelines: outcomes.map((outcome) => outcome.pipeline).sort(),
      },
      expected: {
        urls: [
          'https://pagespace.test/api/ai/page-agents/consult',
          'https://pagespace.test/api/ai/page-agents/consult',
        ],
        auth: ['Bearer tok', 'Bearer tok'],
        agents: ['agent1', 'agent1'],
        pipelines: ['technical-docs', 'user-docs'],
      },
    });
  });

  test('never uses the unframed context field', async () => {
    const { calls, fetchImpl } = recordingFetch(ok);
    await dispatchDocumentationEvent(mergeEvent(), {
      ...baseOptions,
      fetchImpl,
    });
    assert({
      given: 'the consult route prepends context to the question unframed',
      should: 'send the event only inside the fenced question',
      actual: calls.some((call) => 'context' in call.body),
      expected: false,
    });
  });

  test('sends the derived conversation id so replays collide', async () => {
    const event = mergeEvent();
    const { calls, fetchImpl } = recordingFetch(ok);
    await dispatchDocumentationEvent(event, {
      ...baseOptions,
      fetchImpl,
    });
    assert({
      given: 'a dispatch',
      should: 'address each consult by its deterministic conversation id',
      actual: calls.map((call) => call.body.newConversationId).sort(),
      expected: [
        conversationIdFor(event.idempotencyKey, 'technical-docs'),
        conversationIdFor(event.idempotencyKey, 'user-docs'),
      ].sort(),
    });
  });

  test('does not retry a non-idempotent consult', async () => {
    let attempts = 0;
    const fetchImpl = (async () => {
      attempts += 1;
      return new Response('busy', { status: 503 });
    }) as unknown as typeof fetch;
    let threw = false;
    try {
      await dispatchDocumentationEvent(mergeEvent('fix: only technical'), {
        ...baseOptions,
        fetchImpl,
      });
    } catch {
      threw = true;
    }
    assert({
      given: 'a 503 on a merge routed to one pipeline',
      should:
        'fail after exactly one attempt rather than double-running the agent',
      actual: { attempts, threw },
      expected: { attempts: 1, threw: true },
    });
  });

  test('settles a dropped connection by reading the conversation', async () => {
    const { fetchImpl } = routedFetch({
      consult: () => Promise.reject(new TypeError('socket closed')),
      roles: () => ['user', 'assistant'],
    });
    const outcomes = await dispatchDocumentationEvent(
      mergeEvent('fix: only technical'),
      { ...baseOptions, ...instant, fetchImpl },
    );
    assert({
      given: 'a connection dropped mid-run whose conversation holds the answer',
      should: 'report dispatched rather than raise a false incident',
      actual: outcomes.map((outcome) => outcome.outcome),
      expected: ['dispatched'],
    });
  });

  test('waits through an unfinished conversation until the answer lands', async () => {
    let reads = 0;
    const { counts, fetchImpl } = routedFetch({
      consult: () => Promise.reject(new TypeError('socket closed')),
      roles: () => (++reads < 3 ? ['user'] : ['user', 'assistant']),
    });
    const outcomes = await dispatchDocumentationEvent(
      mergeEvent('fix: only technical'),
      { ...baseOptions, ...instant, fetchImpl },
    );
    assert({
      given: 'a conversation that holds only the question for two reads',
      should: 'keep polling and report dispatched once the answer appears',
      actual: {
        outcome: outcomes.map((outcome) => outcome.outcome),
        reads: counts.messages,
      },
      expected: { outcome: ['dispatched'], reads: 3 },
    });
  });

  test('fails fast when the request never reached PageSpace', async () => {
    const { counts, fetchImpl } = routedFetch({
      consult: () => Promise.reject(new TypeError('getaddrinfo ENOTFOUND')),
      roles: () => [],
    });
    let message = 'no throw';
    try {
      await dispatchDocumentationEvent(mergeEvent('fix: only technical'), {
        ...baseOptions,
        ...instant,
        fetchImpl,
      });
    } catch (error) {
      message = (error as Error).message;
    }
    assert({
      given: 'a transport failure and a conversation that never appears',
      should: 'fail after one grace read, naming the original error',
      actual: {
        reads: counts.messages,
        neverReached: message.includes('never reached PageSpace'),
        cause: message.includes('getaddrinfo ENOTFOUND'),
      },
      expected: { reads: 2, neverReached: true, cause: true },
    });
  });

  test('fails loudly when the run has not answered by the deadline', async () => {
    const { fetchImpl } = routedFetch({
      consult: hangUntilAborted,
      roles: () => ['user'],
    });
    let message = 'no throw';
    try {
      await dispatchDocumentationEvent(mergeEvent('fix: only technical'), {
        ...baseOptions,
        ...instant,
        fetchImpl,
        timeoutMs: 5,
      });
    } catch (error) {
      message = (error as Error).message;
    }
    assert({
      given: 'a run whose conversation still lacks an answer at the deadline',
      should: 'throw and point at the next replay attempt',
      actual: {
        names: message.includes('technical-docs did not answer'),
        replay: message.includes('DOC_REPLAY_ATTEMPT=1'),
      },
      expected: { names: true, replay: true },
    });
  });

  test('addresses a replay attempt by its own id', async () => {
    const event = mergeEvent('fix: only technical');
    const { calls, fetchImpl } = recordingFetch(ok);
    await dispatchDocumentationEvent(event, {
      ...baseOptions,
      fetchImpl,
      attempt: 2,
    });
    assert({
      given: 'a replay with attempt 2',
      should: 'send the attempt-2 id so it cannot collide with the burned one',
      actual: calls.map((call) => call.body.newConversationId),
      expected: [conversationIdFor(event.idempotencyKey, 'technical-docs', 2)],
    });
  });

  test('rejects a malformed replay attempt', async () => {
    let message = 'no throw';
    try {
      await dispatchDocumentationEvent(mergeEvent(), {
        ...baseOptions,
        attempt: -1,
      });
    } catch (error) {
      message = (error as Error).message;
    }
    assert({
      given: 'a negative replay attempt',
      should: 'refuse it rather than mint an unexpected id',
      actual: message,
      expected: 'DOC_REPLAY_ATTEMPT must be a non-negative integer',
    });
  });

  test('refuses to run without a token', async () => {
    let message = 'no throw';
    try {
      await dispatchDocumentationEvent(mergeEvent(), {
        token: '',
        apiUrl: 'https://pagespace.test',
        agentId: 'agent1',
      });
    } catch (error) {
      message = (error as Error).message;
    }
    assert({
      given: 'no PAGESPACE_TOKEN',
      should: 'throw rather than silently skip the dispatch',
      actual: message,
      expected: 'Missing PAGESPACE_TOKEN',
    });
  });

  test('refuses a non-https API host', async () => {
    let message = 'no throw';
    try {
      await dispatchDocumentationEvent(mergeEvent(), {
        token: 'tok',
        apiUrl: 'http://pagespace.test',
        agentId: 'agent1',
      });
    } catch (error) {
      message = (error as Error).message;
    }
    assert({
      given: 'a plain-http API host',
      should: 'refuse to send the bearer token over it',
      actual: message,
      expected: 'PAGESPACE_API_URL must use https to protect the bearer token',
    });
  });
});
