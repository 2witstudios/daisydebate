import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createLogger } from './index';

setupRitewayBun();

describe('structured logging', () => {
  test('logs structured context and redacts authentication fields', () => {
    let output = '';
    const logger = createLogger({
      service: 'test',
      destination: {
        write: (text) => {
          output += text;
        },
      },
    });
    logger.child({ requestId: 'request-1' }).info(
      {
        authorization: 'secret',
        headers: { cookie: 'session' },
        durationMs: 12,
      },
      'completed',
    );
    const entry = JSON.parse(output) as {
      requestId: string;
      durationMs: number;
    };
    assert({
      given: 'a child logger with a request id',
      should: 'include the request id on emitted entries',
      actual: entry.requestId,
      expected: 'request-1',
    });
    assert({
      given: 'a log call with a duration field',
      should: 'keep structured numeric fields',
      actual: entry.durationMs,
      expected: 12,
    });
    assert({
      given: 'authorization and cookie values in log fields',
      should: 'redact them from the output',
      actual: output.includes('session') || output.includes('secret'),
      expected: false,
    });
  });
});
