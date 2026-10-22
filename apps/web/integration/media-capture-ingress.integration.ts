import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { createMediaWorkerAuthentication } from '@daisy/media/internal';
import { createMediaWorkerClient } from '@daisy/media/worker';
import { createMediaCaptureHandlers } from '../src/features/media-capture/handlers';
import { createMediaWorkerTokenBroker } from '../src/features/round-media/worker-token';
import {
  withMediaRound,
  mediaDependencies,
  tokenClaims,
  captureWorkerScope,
  captureOperations,
  captureActivityRelay,
} from './round-media.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('signed native HTTP ingress uses actual lease, snapshot and vendor token producers', async () => {
  await withMediaRound(async (f) => {
    const scope = await captureWorkerScope(f);
    const capture = captureOperations(f);
    const deps = mediaDependencies(f, f.media);
    const broker = createMediaWorkerTokenBroker({
      sessions: deps.store,
      capture,
      media: deps.media,
      workerUrl: deps.workerUrl,
      nextId: deps.nextId,
      deadline: deps.deadline,
    });
    const authentication = createMediaWorkerAuthentication({
      secret: Buffer.alloc(32, 9).toString('base64url'),
      now: Date.now,
    });
    const handlers = createMediaCaptureHandlers({
      logger: deps.logger,
      authentication: () => authentication,
      capture: () => capture,
      token: (input, principal) => broker.captureToken(input, principal),
      activity: captureActivityRelay(f, capture),
    });
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: handlers.handle,
    });
    const post = (
      operation: string,
      payload: Record<string, unknown>,
      tamper = false,
    ) => {
      const path = `/api/internal/media/${f.roundId}/capture/${operation}`;
      const body = JSON.stringify(payload);
      const signed = authentication.sign({ method: 'POST', path, body });
      return fetch(`http://127.0.0.1:${server.port}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-daisy-media-timestamp': signed.timestamp,
          'x-daisy-media-signature': signed.signature,
        },
        body: tamper ? `${body} ` : body,
      });
    };
    try {
      const noLease = await post('token', { ...scope, epoch: 1 });
      const tampered = await post('lease', { ...scope, leaseMs: 30000 }, true);
      const [before] =
        await f.sql`select count(*)::integer as n from media_worker_leases where session_id=${scope.sessionId}`;
      const lease = await post('lease', { ...scope, leaseMs: 30000 });
      const leased = await lease.json();
      const read = await post('read', { ...scope, epoch: leased.epoch });
      const state = await read.json();
      const token = await post('token', { ...scope, epoch: leased.epoch });
      const minted = await token.json();
      assert({
        given:
          'real signed HTTP calls crossing the same-pool capture and LiveKit broker boundaries',
        should:
          'refuse unsigned changes before writes and expose only the leased Round with hidden receive-only credentials',
        actual: [
          noLease.status,
          tampered.status,
          before!.n,
          lease.status,
          read.status,
          state.roundId,
          token.status,
          tokenClaims(minted.token).video,
        ],
        expected: [
          409,
          403,
          0,
          200,
          200,
          scope.roundId,
          200,
          {
            roomJoin: true,
            room: minted.roomName,
            canPublish: false,
            canSubscribe: true,
            canPublishData: false,
            canPublishSources: [],
            canUpdateOwnMetadata: false,
            hidden: true,
          },
        ],
      });
      const client = createMediaWorkerClient({
        scope,
        url: `http://127.0.0.1:${server.port}`,
        authentication,
        fetch,
        nowMs: performance.now,
        deadlineSignal: () => AbortSignal.timeout(5000),
      });
      const renewed = await client.lease(30000);
      const snapshot = await client.read({ epoch: renewed.epoch });
      const actualToken = await client.token(renewed.epoch);
      assert({
        given: 'the actual worker transport signing requests to real ingress',
        should:
          'renew, calibrate the PG receipt and mint through the same authority path',
        actual: [
          snapshot.state.roundId,
          snapshot.calibration.receivedAtMs >= snapshot.calibration.sentAtMs,
          snapshot.calibration.serverNowMs ===
            Date.parse(snapshot.state.serverNow),
          tokenClaims(actualToken.token).video.hidden,
        ],
        expected: [scope.roundId, true, true, true],
      });
      const changedScope = await post('read', {
        ...scope,
        roundId: createId(),
        epoch: leased.epoch,
      });
      const extraPrincipal = await post('lease', {
        ...scope,
        leaseMs: 30000,
        serviceId: 'injected',
      });
      assert({
        given:
          'signed bodies attempting to replace route or principal authority',
        should: 'refuse both before accepting any caller-provided principal',
        actual: [changedScope.status, extraPrincipal.status],
        expected: [403, 403],
      });
    } finally {
      await server.stop(true);
    }
  });
});
