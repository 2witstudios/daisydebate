import { describe, test } from 'riteway/bun';
import { setupRitewayBun, assert } from 'riteway/bun';
import { dispatchDocumentationEvent } from './docs-consult';
import {
  baseOptions,
  hangUntilAborted,
  instant,
  mergeEvent,
  routedFetch,
} from './docs-consult.test-support';

setupRitewayBun();

describe('dispatchDocumentationEvent settlement', async () => {
  test('settles a gateway 5xx by reading the conversation', async () => {
    const { fetchImpl } = routedFetch({
      consult: async () => new Response('', { status: 502 }),
      roles: () => ['user', 'assistant'],
    });
    const outcomes = await dispatchDocumentationEvent(
      mergeEvent('fix: only technical'),
      { ...baseOptions, ...instant, fetchImpl },
    );
    assert({
      given: 'a 502 from a gateway while the run behind it finishes',
      should: 'report dispatched rather than raise a false incident',
      actual: outcomes.map((outcome) => outcome.outcome),
      expected: ['dispatched'],
    });
  });

  test('fails fast on a 5xx whose request never landed', async () => {
    const { fetchImpl } = routedFetch({
      consult: async () => new Response('', { status: 502 }),
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
      given: 'a 502 and a conversation that never appears',
      should: 'fail naming the status as the cause',
      actual: message,
      expected:
        'Documentation Agent consult for technical-docs never reached PageSpace: responded 502',
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

  test('reads a runtime timeout the same as an expired wait', async () => {
    const { fetchImpl } = routedFetch({
      consult: () =>
        Promise.reject(
          new DOMException('The operation timed out.', 'TimeoutError'),
        ),
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
      given: 'the runtime raising TimeoutError instead of AbortError',
      should: 'name the expired wait as the cause',
      actual: message.includes('(no answer within'),
      expected: true,
    });
  });
});
