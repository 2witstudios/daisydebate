import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { Logger } from '@daisy/logger';
import { silentLogger } from '../../server/test-loggers.test-support';
import { createAfterResponse } from './after-response';

setupRitewayBun();

/** A promise and the function that resolves it. */
const gate = () => {
  let open = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
};

describe('createAfterResponse', () => {
  test('starts the work a request queued only once its handler has returned', async () => {
    const steps: string[] = [];
    const { defer, around, settled } = createAfterResponse(silentLogger);
    const answer = await around(async () => {
      defer(async () => void steps.push('work'));
      await Promise.resolve();
      steps.push('answered');
      return 'answer';
    });
    await settled();
    assert({
      given: 'work queued in the middle of a request',
      should: 'run it after the request has produced its answer',
      actual: { answer, steps },
      expected: { answer: 'answer', steps: ['answered', 'work'] },
    });
  });

  test('still starts queued work when the handler throws', async () => {
    const steps: string[] = [];
    const { defer, around, settled } = createAfterResponse(silentLogger);
    const failure = await around(async () => {
      defer(async () => void steps.push('work'));
      throw new Error('handler failed');
    }).catch((error: unknown) => (error as Error).message);
    await settled();
    assert({
      given: 'a request that queues work and then throws',
      should: 'rethrow the failure and still run the queued work',
      actual: { failure, steps },
      expected: { failure: 'handler failed', steps: ['work'] },
    });
  });

  test('does not make a direct caller wait on work queued outside a request', async () => {
    const { opened, open } = gate();
    const steps: string[] = [];
    const { defer, settled } = createAfterResponse(silentLogger);
    defer(async () => {
      await opened;
      steps.push('work');
    });
    steps.push('caller continued');
    open();
    await settled();
    assert({
      given: 'work queued with no request in progress',
      should: 'start it without the caller waiting on it',
      actual: steps,
      expected: ['caller continued', 'work'],
    });
  });

  test('settles only once every started piece of work has finished', async () => {
    const { opened, open } = gate();
    const { defer, around, settled } = createAfterResponse(silentLogger);
    let finished = false;
    await around(async () =>
      defer(async () => {
        await opened;
        finished = true;
      }),
    );
    const settling = settled().then(() => finished);
    open();
    assert({
      given: 'work still waiting when settled() is called',
      should: 'resolve settled() after that work has finished',
      actual: await settling,
      expected: true,
    });
  });

  test('logs a failed piece of work instead of rejecting unhandled', async () => {
    const logged: unknown[][] = [];
    const logger: Logger = {
      log: (...entry) => void logged.push(entry),
      child: () => logger,
    };
    const { defer, around, settled } = createAfterResponse(logger);
    await around(async () =>
      defer(async () => {
        throw new Error('lookup failed');
      }),
    );
    await settled();
    assert({
      given: 'queued work that rejects',
      should: 'log request.unhandled once, without the error',
      actual: logged,
      expected: [
        [
          'request.unhandled',
          { source: 'auth.after-response' },
          'Authentication work after the answer failed',
        ],
      ],
    });
  });
});
