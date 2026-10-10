import { assert, setupRitewayBun, test } from 'riteway/bun';
import { submitMessagingForm } from './messaging-form-submit';
setupRitewayBun();
test('native message submission verifies exact operation result scope before navigating', async () => {
  const id = 'm'.repeat(24),
    seen: unknown[] = [];
  const submit = (body: unknown, status = 200) =>
    submitMessagingForm(
      new Headers({ cookie: 'unit-cookie' }),
      async (request) => {
        seen.push([
          request.method,
          new URL(request.url).pathname,
          request.headers.get('cookie'),
          await request.json(),
        ]);
        return Response.json(body, { status });
      },
      '/api/messaging/reactions',
      { version: 1 },
      { field: 'messageId', value: id },
    );
  const outcomes = await Promise.all([
    submit({ messageId: id }),
    submit({ messageId: 'x'.repeat(24) }),
    submit({ messageId: id }, 403),
  ]);
  assert({
    given: 'accepted, foreign-result and refused native operation replies',
    should:
      'navigate only after the expected bound message reply while forwarding current identity',
    actual: [outcomes, seen[0]],
    expected: [
      [true, false, false],
      ['POST', '/api/messaging/reactions', 'unit-cookie', { version: 1 }],
    ],
  });
});
