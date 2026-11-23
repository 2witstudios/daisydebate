import { describe, test, assert, setupRitewayBun } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { virtualClock } from '@daisy/clock/testing';
import { createPostHogErasure } from './erase-vendor';

setupRitewayBun();
describe('PostHog erasure acknowledgement', () => {
  test('an already absent person is acknowledged without retrying forever', async () => {
    const port = createPostHogErasure({
      host: 'https://us.posthog.com',
      projectId: '1',
      key: 'test-management',
      waits: virtualClock(),
      fetch: async () =>
        Response.json(
          {
            persons_found: 0,
            events_queued_for_deletion: false,
            recordings_queued_for_deletion: false,
            deletion_errors: [],
          },
          { status: 202 },
        ),
    });
    await port.erase('u'.repeat(24));
    assert({
      given: 'a repeat deletion after the vendor person is absent',
      should: 'acknowledge the explicit empty match',
      actual: await port.erase('u'.repeat(24)),
      expected: undefined,
    });
  });
  test('a nonempty match without queued deletion is refused', async () => {
    const port = createPostHogErasure({
      host: 'https://us.posthog.com',
      projectId: '1',
      key: 'test-management',
      waits: virtualClock(),
      fetch: async () =>
        Response.json(
          {
            persons_found: 1,
            events_queued_for_deletion: false,
            recordings_queued_for_deletion: false,
            deletion_errors: [],
          },
          { status: 202 },
        ),
    });
    await assertRejects({
      given: 'a matched person whose data deletion was not queued',
      should: 'retain the durable retry obligation',
      actual: () => port.erase('u'.repeat(24)),
      code: 'INFRASTRUCTURE',
    });
  });
  test('deletes all vendor-held subject surfaces', async () => {
    let body: unknown;
    const port = createPostHogErasure({
      host: 'https://eu.posthog.com',
      projectId: '1',
      key: 'test-management',
      waits: virtualClock(),
      fetch: async (_url, init) => {
        body = JSON.parse(String(init.body));
        return Response.json(
          {
            events_queued_for_deletion: true,
            recordings_queued_for_deletion: true,
            deletion_errors: [],
          },
          { status: 202 },
        );
      },
    });
    await port.erase('u'.repeat(24));
    assert({
      given: 'a subject erasure',
      should: 'request person, event and replay deletion together',
      actual: body,
      expected: {
        distinct_ids: ['u'.repeat(24)],
        delete_events: true,
        delete_recordings: true,
        keep_person: false,
      },
    });
  });
  test('HTTP success alone is not acknowledgement', async () => {
    const port = createPostHogErasure({
      host: 'https://us.posthog.com',
      projectId: '1',
      key: 'test-management',
      waits: virtualClock(),
      fetch: async () =>
        Response.json(
          {
            events_queued_for_deletion: true,
            recordings_queued_for_deletion: true,
            deletion_errors: ['refused'],
          },
          { status: 202 },
        ),
    });
    await assertRejects({
      given: 'a vendor refusal inside a successful HTTP response',
      should: 'leave the durable job eligible for retry',
      actual: () => port.erase('u'.repeat(24)),
      code: 'INFRASTRUCTURE',
    });
  });
});

describe('PostHog erasure deadline', () => {
  test('a request that never answers is refused after five seconds', async () => {
    const clock = virtualClock();
    const port = createPostHogErasure({
      host: 'https://us.posthog.com',
      projectId: '1',
      key: 'test-management',
      waits: clock,
      fetch: (_url, init) =>
        new Promise<Response>((_, reject) =>
          init.signal?.addEventListener('abort', () =>
            reject(init.signal?.reason),
          ),
        ),
    });
    const erased = port.erase('u'.repeat(24)).then(
      () => 'erased',
      (error: unknown) => (error as Error).name,
    );
    await clock.advance(5000);
    assert({
      given: 'a vendor request held open for five seconds of injected time',
      should: 'abort it with a timeout so the retry obligation remains',
      actual: await erased,
      expected: 'TimeoutError',
    });
  });
});
