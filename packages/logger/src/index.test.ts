import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createLogger, type EventName } from './index';

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
      'server.start',
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

  test('rejects events outside the public vocabulary at compile time', () => {
    const logger = createLogger({ service: 'test' });
    // @ts-expect-error Event names are intentionally closed to known telemetry events.
    logger.info('not-a-telemetry-event', {}, 'invalid');
    const event: EventName = 'server.start';
    assert({
      given: 'a known telemetry event name',
      should: 'be accepted by the logger API',
      actual: event,
      expected: 'server.start',
    });
  });

  test('degrades an unknown runtime event to telemetry.unknown_event', () => {
    let output = '';
    const logger = createLogger({
      service: 'test',
      destination: { write: (text) => (output += text) },
    });
    logger.info(
      'not-a-telemetry-event' as EventName,
      {},
      'invalid runtime event',
    );
    const entry = JSON.parse(output) as { event: string };
    assert({
      given: 'an event supplied by an untyped runtime boundary',
      should: 'emit the stable unknown-event telemetry name',
      actual: entry.event,
      expected: 'telemetry.unknown_event',
    });
  });
});
