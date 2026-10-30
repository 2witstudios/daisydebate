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
