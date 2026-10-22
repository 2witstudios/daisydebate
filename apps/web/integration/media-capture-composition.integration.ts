import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { randomBytes } from 'node:crypto';
import { createMediaWorkerAuthentication } from '@daisy/media/internal';
import { createTestApp } from './fixtures';
import {
  tokenClaims,
  withMediaRound,
  captureWorkerScope,
} from './round-media.test-support';

setupRitewayBun();
requireTestServices(process.env);

test('the application composition binds signed capture to its real database and vendor broker', async () => {
  const secret = randomBytes(32).toString('base64url');
  const authentication = createMediaWorkerAuthentication({
    secret,
    now: Date.now,
  });
  await withMediaRound(async (f) => {
    const app = createTestApp({
      MEDIA_WORKER_SECRET: secret,
      LIVEKIT_URL: f.mediaConfig.url,
      LIVEKIT_PUBLIC_URL: 'wss://localhost.invalid',
      LIVEKIT_API_KEY: f.mediaConfig.apiKey,
      LIVEKIT_API_SECRET: f.mediaConfig.apiSecret,
    });
    const scope = await captureWorkerScope(f);
    const call = (operation: string, extra: Record<string, unknown>) => {
      const path = `/api/internal/media/${f.roundId}/capture/${operation}`;
      const body = JSON.stringify({ ...scope, ...extra });
      const signed = authentication.sign({ method: 'POST', path, body });
      return app.routes.mediaCapture.handle(
        new Request(`https://daisy.test${path}`, {
          method: 'POST',
          body,
          headers: {
            'x-daisy-media-signature': signed.signature,
            'x-daisy-media-timestamp': signed.timestamp,
          },
        }),
      );
    };
    const claimed = await call('lease', { leaseMs: 30_000 });
    const lease = await claimed.json();
    const token = await call('token', { epoch: lease.epoch });
    const minted = await token.json();
    assert({
      given:
        'the actual shared application route factory and an existing real media binding',
      should:
        'claim its bounded worker lease and mint only a hidden subscribe-only vendor token',
      actual: [
        claimed.status,
        token.status,
        tokenClaims(minted.token).video.canPublish,
        tokenClaims(minted.token).video.hidden,
      ],
      expected: [200, 200, false, true],
    });
  });
});
