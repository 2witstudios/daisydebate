import { describe, test } from 'riteway/bun';
import { setupRitewayBun, assert } from 'riteway/bun';
import { dispatchDocumentationEvent } from './docs-consult';
import {
  baseOptions,
  failureOf,
  hangUntilAborted,
  instant,
  mergeEvent,
  routedFetch,
  routeFailure,
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
        'Documentation Agent consult for technical-docs never reached PageSpace (responded 502). Its receipt, row 2 of Documentation Runs, stays failed unless the request lands late; replay with DOC_REPLAY_ATTEMPT=0 DOC_PIPELINES=technical-docs',
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
      should:
        'say the run may still finish, name its receipt row, and give a targeted replay',
      actual: {
        names: message.includes('technical-docs did not answer'),
        mayFinish: message.includes('The run may still finish'),
        row: message.includes('row 2 of Documentation Runs'),
        replay: message.includes(
          'DOC_REPLAY_ATTEMPT=1 DOC_PIPELINES=technical-docs',
        ),
      },
      expected: { names: true, mayFinish: true, row: true, replay: true },
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

  test('leaves time to read the conversation after a consult times out', async () => {
    const { fetchImpl } = routedFetch({
      consult: hangUntilAborted,
      roles: () => ['user', 'assistant'],
      readDelayMs: 20,
    });
    const outcomes = await dispatchDocumentationEvent(
      mergeEvent('fix: only technical'),
      { ...baseOptions, ...instant, fetchImpl, timeoutMs: 5 },
    );
    assert({
      given: 'a consult aborted at its deadline whose run has in fact answered',
      should:
        'still read the conversation and report dispatched, not "never reached"',
      actual: outcomes.map((outcome) => outcome.outcome),
      expected: ['dispatched'],
    });
  });

  test('never waits between polls past the consult deadline', async () => {
    const { fetchImpl } = routedFetch({
      consult: async () => new Response('', { status: 502 }),
      roles: () => ['user'],
    });
    const started = Date.now();
    let message = 'no throw';
    try {
      await dispatchDocumentationEvent(mergeEvent('fix: only technical'), {
        ...baseOptions,
        fetchImpl,
        timeoutMs: 50,
        pollIntervalMs: 10_000,
      });
    } catch (error) {
      message = (error as Error).message;
    }
    assert({
      given:
        'a poll interval far longer than the time left before the deadline',
      should:
        'shorten the wait to the deadline instead of overrunning the budget',
      actual: {
        reportedPending: message.includes('did not answer within'),
        finishedWell: Date.now() - started < 2_000,
      },
      expected: { reportedPending: true, finishedWell: true },
    });
  });

  test('stops at once on a failure the consult route itself reports', async () => {
    let waits = 0;
    const { counts, fetchImpl } = routedFetch({
      consult: async () => routeFailure(),
      roles: () => ['user'],
    });
    const message = await failureOf(
      dispatchDocumentationEvent(mergeEvent('fix: only technical'), {
        ...baseOptions,
        fetchImpl,
        timeoutMs: 50,
        pollIntervalMs: 0,
        delay: async () => {
          waits += 1;
        },
      }),
    );
    assert({
      given:
        'a JSON 500 from the consult route, which answers only once its run has ended',
      should:
        'read the conversation once, not poll to the deadline, and give a targeted replay',
      actual: {
        reads: counts.messages,
        waits,
        failed: message.includes(
          'technical-docs failed in PageSpace (responded 500: Failed to generate response from agent: provider unavailable)',
        ),
        hedged: message.includes('shows complete, nothing is lost'),
        row: message.includes('row 2 of Documentation Runs'),
        replay: message.includes(
          'DOC_REPLAY_ATTEMPT=1 DOC_PIPELINES=technical-docs',
        ),
      },
      expected: {
        reads: 1,
        waits: 0,
        failed: true,
        hedged: true,
        row: true,
        replay: true,
      },
    });
  });

  test('reports a route failure after the answer was saved as dispatched', async () => {
    const { fetchImpl } = routedFetch({
      consult: async () => routeFailure(),
      roles: () => ['user', 'assistant'],
    });
    const outcomes = await dispatchDocumentationEvent(
      mergeEvent('fix: only technical'),
      { ...baseOptions, ...instant, fetchImpl },
    );
    assert({
      given: 'a route 500 raised after the run persisted its answer',
      should: 'trust the conversation and report dispatched',
      actual: outcomes.map((outcome) => outcome.outcome),
      expected: ['dispatched'],
    });
  });

  test('reads again when a route failure meets an empty conversation', async () => {
    let reads = 0;
    const { counts, fetchImpl } = routedFetch({
      consult: async () => routeFailure(),
      roles: () => (++reads < 2 ? [] : ['user', 'assistant']),
    });
    const outcomes = await dispatchDocumentationEvent(
      mergeEvent('fix: only technical'),
      { ...baseOptions, ...instant, fetchImpl },
    );
    assert({
      given: 'a route 500 whose first conversation read comes back empty',
      should: 'read once more before failing, and find the saved answer',
      actual: {
        outcome: outcomes.map((outcome) => outcome.outcome),
        reads: counts.messages,
      },
      expected: { outcome: ['dispatched'], reads: 2 },
    });
  });

  test('keeps polling a gateway 5xx in front of a slow run', async () => {
    let reads = 0;
    const { counts, fetchImpl } = routedFetch({
      consult: async () =>
        new Response('<html>502 Bad Gateway</html>', {
          status: 502,
          headers: { 'content-type': 'text/html' },
        }),
      roles: () => (++reads < 4 ? ['user'] : ['user', 'assistant']),
    });
    const outcomes = await dispatchDocumentationEvent(
      mergeEvent('fix: only technical'),
      { ...baseOptions, ...instant, fetchImpl },
    );
    assert({
      given: 'a gateway 502 whose run is still going and answers on read 4',
      should: 'keep polling rather than declare the run dead',
      actual: {
        outcome: outcomes.map((outcome) => outcome.outcome),
        reads: counts.messages,
      },
      expected: { outcome: ['dispatched'], reads: 4 },
    });
  });

  test('reads again when a route failure meets an unreadable conversation', async () => {
    const { counts, fetchImpl } = routedFetch({
      consult: async () => routeFailure(),
      readStatus: 503,
    });
    const message = await failureOf(
      dispatchDocumentationEvent(mergeEvent('fix: only technical'), {
        ...baseOptions,
        ...instant,
        fetchImpl,
      }),
    );
    assert({
      given: 'a route 500 whose conversation reads keep failing',
      should: 'read once more, then fail as a route failure without polling',
      actual: {
        reads: counts.messages,
        routeFailed: message.includes('failed in PageSpace'),
      },
      expected: { reads: 2, routeFailed: true },
    });
  });
});
