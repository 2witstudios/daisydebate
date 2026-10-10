import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fixedClock, sequentialId } from '@daisy/clock';
import {
  messagingTestPosting,
  messagingTestReading,
} from '@daisy/auth/testing';
import { createMessagingUnitApp } from '../messaging-app.test-support';
import { authTestEnv } from '../../auth/auth-server.test-support';
import { composeMessagingFileRoutes } from './route-composition';
import { fileOperationFixture } from './operations.test-support';
setupRitewayBun();
test('configured mounted file routes still authenticate before any private vendors and missing configuration stays unavailable', async () => {
  const f = fileOperationFixture();
  const policy = f.d.policy;
  if (!policy) throw new Error('Explicit file fixture policy required');
  const limits = { max: 2, windowSeconds: 60 };
  const app = createMessagingUnitApp({
    clock: fixedClock(f.state.now),
    ids: sequentialId('file-route'),
    messagingPolicy: {
      posting: messagingTestPosting,
      reading: messagingTestReading,
      bounds: { messageUnits: 100, pageItems: 20 },
      maxBodyBytes: 1024,
      editWindowMs: 1000,
      limits: { actorSend: limits, channelSend: limits, read: limits },
    },
    messagingFiles: { ...f.d, policy, maxMultipartBytes: 2048 },
  });
  try {
    const routes = composeMessagingFileRoutes(app);
    const request = () =>
      new Request(`${authTestEnv.PUBLIC_APP_URL}/api/messaging/files`, {
        method: 'POST',
        headers: {
          origin: authTestEnv.PUBLIC_APP_URL,
          'content-type': 'application/json',
        },
        body: '{}',
      });
    const status: number[] = [];
    for (const method of [
      'reserve',
      'finalize',
      'renew',
      'cancel',
      'cleanup',
    ] as const)
      status.push((await routes[method](request())).status);
    status.push(
      (await routes.upload(request(), f.channelId, f.fileId)).status,
      (await routes.download(request(), f.channelId, f.fileId)).status,
      (await routes.list(request(), f.channelId)).status,
      (
        await routes.attach(request(), f.channelId, f.messageId, () => {
          throw new Error('Unexpected success');
        })
      ).status,
      (await routes.discard(request(), f.channelId)).status,
    );
    assert({
      given: 'real configured application with anonymous mounted file requests',
      should: 'refuse every edge before private store or scanner callbacks',
      actual: [status, f.calls],
      expected: [Array(10).fill(401), []],
    });
    const unavailable = composeMessagingFileRoutes({
      ...app,
      messagingFiles: null,
    });
    assert({
      given: 'same application without explicitly injected storage/scanner',
      should:
        'refuse JSON, private download, native attachment and pending discard as unavailable',
      actual: [
        (await unavailable.reserve(request())).status,
        (await unavailable.download(request(), f.channelId, f.fileId)).status,
        (
          await unavailable.attach(request(), f.channelId, f.messageId, () =>
            Response.json({}),
          )
        ).status,
        (await unavailable.discard(request(), f.channelId)).status,
      ],
      expected: [503, 503, 503, 503],
    });
  } finally {
    await app.close();
  }
});
