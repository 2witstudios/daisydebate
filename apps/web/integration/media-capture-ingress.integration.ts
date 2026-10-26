import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { createMediaWorkerAuthentication } from '@daisy/media/internal';
import { createMediaWorkerClient } from '@daisy/media/worker';
import { createMediaCaptureHandlers } from '../src/features/media-capture/handlers';
import {
  withMediaRound,
  mediaDependencies,
  tokenClaims,
  captureWorkerScope,
  captureActivityRelay,
  captureHeardRelay,
  startCaptureSpeech,
} from './round-media.test-support';
import { captureTokenBroker } from './capture-token.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('signed native HTTP ingress uses actual lease, snapshot and vendor token producers', async () => {
  await withMediaRound(async (f) => {
    const scope = await captureWorkerScope(f);
    const { capture, broker } = captureTokenBroker(f);
    const deps = mediaDependencies(f, f.media);
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
      heard: captureHeardRelay(f, capture),
    });
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: handlers.handle,
    });
    const signedRequest = (
      operation: string,
      payload: Record<string, unknown>,
      tamper = false,
    ) => {
      const path = `/api/internal/media/${f.roundId}/capture/${operation}`;
      const body = JSON.stringify(payload);
      const signed = authentication.sign({ method: 'POST', path, body });
      return new Request(`http://127.0.0.1:${server.port}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-daisy-media-timestamp': signed.timestamp,
          'x-daisy-media-signature': signed.signature,
        },
        body: tamper ? `${body} ` : body,
      });
    };
    const post = (...args: Parameters<typeof signedRequest>) =>
      fetch(signedRequest(...args));
    const replay = async (
      operation: string,
      payload: Record<string, unknown>,
    ) => {
      const request = signedRequest(operation, payload);
      const first = await fetch(request.clone());
      const second = await fetch(request.clone());
      return {
        statuses: [first.status, second.status],
        bodies: [await first.json(), await second.json()],
      };
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
      const reclaimed = await replay('lease', { ...scope, leaseMs: 30000 });
      assert({
        given:
          'the exact signed lease request delivered twice inside the authentication window',
        should: 'retain the current epoch instead of granting new authority',
        actual: {
          statuses: reclaimed.statuses,
          epochs: reclaimed.bodies.map((body) => body.epoch),
        },
        expected: {
          statuses: [200, 200],
          epochs: [leased.epoch, leased.epoch],
        },
      });
      await startCaptureSpeech(f);
      const snapshotState = await capture.readMediaCaptureState({
        ...scope,
        epoch: leased.epoch,
      });
      const segmentId = snapshotState.segment!.id;
      const [seat] =
        await f.sql`select id from round_participants where round_id=${f.roundId} and actor_id=${f.host.actorId}`;
      const [clock] = await f.sql`select clock_timestamp() as now`;
      const end = new Date(clock.now.getTime() - 1000);
      const start = new Date(end.getTime() - 1000);
      await f.sql`update rounds set status='completed',outcome='affirmative',completed_at=${end},final_segment_ended_at=${end},transcript_admission_cutoff=${new Date(end.getTime() + 120000)} where id=${f.roundId}`;
      await f.sql`update round_segments set started_at=${start},ended_at=${end},duration_ms=1000 where id=${segmentId}`;
      await f.sql`update round_speaking_intervals set started_at=${start},ended_at=${end},ended_version=started_version+1 where segment_id=${segmentId}`;
      const stream = {
        ...scope,
        epoch: leased.epoch,
        segmentId,
        roundParticipantId: seat.id,
      };
      const trackId = createId();
      const appended = await replay('append', {
        ...stream,
        trackId,
        startOffsetMs: 100,
        durationMs: 100,
        text: 'Synthetic replay proof',
        before: new Date(start.getTime() + 99).toISOString(),
        after: new Date(start.getTime() + 201).toISOString(),
      });
      const observed = await replay('observe', {
        ...stream,
        trackId,
        observedFrom: start.toISOString(),
        observedUntil: end.toISOString(),
      });
      const sealed = await replay('seal', { ...stream, expectedChunkCount: 1 });
      const [facts] = await f.sql`select
        (select count(*)::int from utterances where round_id=${f.roundId}) as utterances,
        (select count(*)::int from transcript_observations where round_id=${f.roundId}) as observations,
        (select revision from round_transcripts where round_id=${f.roundId}) as revision`;
      assert({
        given:
          'identical authenticated append, observe and seal requests each replayed within five seconds',
        should:
          'persist each fact once and preserve the sealed transcript frontier',
        actual: { appended, observed, sealed, facts: { ...facts } },
        expected: {
          appended: {
            statuses: [200, 200],
            bodies: [
              { duplicate: false, revision: 1 },
              { duplicate: true, revision: 1 },
            ],
          },
          observed: {
            statuses: [200, 200],
            bodies: [
              { duplicate: false, revision: 2 },
              { duplicate: true, revision: 2 },
            ],
          },
          sealed: {
            statuses: [200, 200],
            bodies: [
              { state: 'complete', revision: 3 },
              { state: 'complete', revision: 3 },
            ],
          },
          facts: { utterances: 1, observations: 1, revision: 3 },
        },
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
