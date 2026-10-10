import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fixedClock, sequentialId } from '@daisy/clock';
import { createMessagingUnitApp } from './messaging-app.test-support';
import { messagingUnitPolicy } from './typing.test-support';
import { composeMessagingTypingRoutes } from './typing-route';
import { composeMessagingPreferenceRoutes } from './preference-route';
setupRitewayBun();
test('actual optional typing/preference app routes authenticate before configured stores and fail unavailable without explicit typing policy', async () => {
  const policy = messagingUnitPolicy(),
    app = createMessagingUnitApp({
      clock: fixedClock('2026-10-10T12:00:00.000Z'),
      ids: sequentialId('typing-route'),
      messagingPolicy: {
        ...policy,
        typing: { ttlMs: 5000, refetchMs: 1000, maxActors: 2 },
      },
    });
  const origin = app.auth().config.PUBLIC_APP_URL,
    request = () =>
      new Request(origin + '/api/messaging/typing', {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: '{}',
      });
  try {
    const typing = composeMessagingTypingRoutes(app),
      preferences = composeMessagingPreferenceRoutes(app);
    const statuses = [
      (await typing(request(), true)).status,
      (await typing(new Request(origin + '/typing'), false, 'c'.repeat(24)))
        .status,
    ];
    for (const action of ['read', 'update', 'clear'] as const)
      statuses.push(
        (await preferences(request(), action, 'c'.repeat(24))).status,
      );
    const absent = composeMessagingTypingRoutes({
        ...app,
        messagingPolicy: policy,
      }),
      unconfigured = composeMessagingTypingRoutes({
        ...app,
        messagingPolicy: null,
      });
    assert({
      given:
        'actual configured application, anonymous requests and separately absent optional typing policy',
      should:
        'authenticate every store edge and preserve explicit unavailable status without vendor I/O',
      actual: [
        statuses,
        (await absent(request(), true)).status,
        (await unconfigured(request(), false)).status,
        (
          await composeMessagingPreferenceRoutes({
            ...app,
            messagingPolicy: null,
          })(request(), 'clear')
        ).status,
      ],
      expected: [[401, 401, 401, 401, 401], 503, 503, 503],
    });
  } finally {
    await app.close();
  }
});
