import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { scrubEvent, type ScrubbableEvent } from './scrub-event';

setupRitewayBun();

describe('scrubEvent (ADR 0037)', () => {
  test('drops the request body, headers, cookies and query string', () => {
    const event: ScrubbableEvent = {
      request: {
        data: { username: 'sensitive' },
        headers: { cookie: 'session=secret' },
        query_string: 'token=abc',
        cookies: { session: 'secret' },
        url: 'https://daisy.invalid/rooms/create?invite=xyz',
        method: 'POST',
      },
    };
    const scrubbed = scrubEvent(event);
    assert({
      given: 'a request carrying body, headers, cookies and query',
      should: 'keep only the query-free path and the method',
      actual: scrubbed.request,
      expected: {
        url: 'https://daisy.invalid/rooms/create',
        method: 'POST',
      },
    });
  });

  test('reduces the user to the cuid2 id alone', () => {
    const event: ScrubbableEvent = {
      user: {
        id: 'm4t97chwn29kyca9aqt8yqk2',
        username: 'im-claire',
        email: 'claire@example.invalid',
        ip_address: '203.0.113.7',
      },
    };
    assert({
      given: 'a user carrying username, email and address',
      should: 'keep the application id only',
      actual: scrubEvent(event).user,
      expected: { id: 'm4t97chwn29kyca9aqt8yqk2' },
    });
  });

  test('drops the user entirely when no id is present', () => {
    assert({
      given: 'a user without an id',
      should: 'report no user at all',
      actual: scrubEvent({ user: { ip_address: '203.0.113.7' } }).user,
      expected: undefined,
    });
  });

  test('drops console breadcrumbs and keeps the rest', () => {
    const event = {
      breadcrumbs: [
        { category: 'console', message: 'token=abc' },
        { category: 'navigation', message: '/rooms' },
      ],
    };
    assert({
      given: 'console and navigation breadcrumbs',
      should: 'keep only navigation',
      actual: scrubEvent(event).breadcrumbs,
      expected: [{ category: 'navigation', message: '/rooms' }],
    });
  });

  test('keeps fields it does not know about', () => {
    const event = {
      event_id: 'e5bf8712',
      tags: { requestId: 'r1', environment: 'production' },
      exception: { values: [{ type: 'Error' }] },
    };
    const scrubbed = scrubEvent(event);
    assert({
      given: 'an event with tags and an exception',
      should: 'pass them through untouched',
      actual: {
        eventId: scrubbed.event_id,
        tags: scrubbed.tags,
        exception: scrubbed.exception,
      },
      expected: {
        eventId: 'e5bf8712',
        tags: { requestId: 'r1', environment: 'production' },
        exception: { values: [{ type: 'Error' }] },
      },
    });
  });

  test('replaces every exception message with a marker, keeping the type and stack', () => {
    // The reported case: a Drizzle query error whose message carries the
    // bound parameters (both addresses of an email change), flattened into
    // the exception chain the vendor serializes.
    const event = {
      exception: {
        values: [
          {
            type: 'Error',
            value:
              'Failed to complete email change with params: (claire@example.invalid, new-claire@example.invalid)',
            stacktrace: {
              frames: [
                {
                  function: 'completeEmailChange',
                  filename: 'app://database.ts',
                },
              ],
            },
            mechanism: { type: 'generic', handled: false },
          },
        ],
      },
    };
    const scrubbed = scrubEvent(event);
    const entry = (
      scrubbed.exception as
        | {
            values: Array<{
              type?: string;
              value?: string;
              stacktrace?: unknown;
            }>;
          }
        | undefined
    )?.values?.[0];
    assert({
      given: 'an exception message carrying bound parameters',
      should: 'deliver no part of the message',
      actual: entry === undefined ? undefined : entry.value,
      expected: '[scrubbed]',
    });
    assert({
      given: 'the same exception entry',
      should: 'keep the class name, the stack frames and the mechanism',
      actual: {
        type: entry === undefined ? undefined : entry.type,
        frames:
          entry === undefined
            ? undefined
            : (entry.stacktrace as { frames?: unknown[] })?.frames?.length,
        mechanism: entry !== undefined && 'mechanism' in entry,
      },
      expected: { type: 'Error', frames: 1, mechanism: true },
    });
  });

  test('scrubs the whole linked-cause chain, not only the outermost error', () => {
    const event = {
      exception: {
        values: [
          { type: 'AppError', value: 'DATABASE_WRITE', causeHandled: true },
          {
            type: 'DrizzleQueryError',
            value: "update actor set email = 'ima@example.invalid' where ...",
          },
        ],
      },
    };
    const scrubbed = scrubEvent(event) as {
      exception: { values: Array<{ value?: string; type?: string }> };
    };
    assert({
      given: 'an exception chain whose inner cause carries the statement',
      should: 'replace every entry’s message and keep every type',
      actual: scrubbed.exception.values.map((entry) => ({
        type: entry.type,
        value: entry.value,
      })),
      expected: [
        { type: 'AppError', value: '[scrubbed]' },
        { type: 'DrizzleQueryError', value: '[scrubbed]' },
      ],
    });
  });

  test('a chain entry without a message stays without one', () => {
    const event = {
      exception: { values: [{ type: 'Error', stacktrace: { frames: [] } }] },
    };
    const scrubbed = scrubEvent(event) as {
      exception: { values: Array<Record<string, unknown>> };
    };
    assert({
      given: 'an exception entry with no value field',
      should: 'not invent a message field',
      actual:
        scrubbed.exception.values.length === 1 &&
        'value' in (scrubbed.exception.values[0] ?? {}),
      expected: false,
    });
  });

  test('never mutates the event it receives', () => {
    const event = {
      request: { data: { secret: 'yes' }, url: '/x?a=1' },
      user: { id: 'u1', email: 'x@example.invalid' },
      breadcrumbs: [{ category: 'console', message: 'leak' }],
    };
    const before = structuredClone(event);
    scrubEvent(event);
    assert({
      given: 'the original event after scrubbing',
      should: 'be unchanged',
      actual: event,
      expected: before,
    });
  });

  test('passes absent request, user and breadcrumbs through as they were', () => {
    assert({
      given: 'an event with no request, user or breadcrumbs',
      should: 'keep those fields absent rather than inventing them',
      actual: scrubEvent({ tags: { x: '1' } }),
      expected: { tags: { x: '1' } },
    });
  });
});
