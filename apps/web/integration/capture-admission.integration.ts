import { hostWaits } from '@daisy/worker/host';
import { instantMs } from '@daisy/clock';
import { randomBytes } from 'node:crypto';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMediaWorkerAuthentication } from '@daisy/media/internal';
import { captureRule } from '@daisy/debate-engine';
import { CAPTURE_STT_LAG_MS } from '@daisy/protocol/capture-timing';
import { finishedOrBlockedBehind } from '@daisy/db/testing';
import { noopErrorReporter } from '@daisy/observability';
import { createAppError } from '@daisy/errors';
import { captureAdmissionPolicy } from '../src/features/media-capture/capture-policy';
import { createMediaCaptureHandlers } from '../src/features/media-capture/handlers';
import { createNecessaryEvidenceIngress } from '../src/features/media-capture/necessary-evidence-ingress';
import { roundTickProjection } from '../src/features/round-finalization/operations';
import { silentLogger } from '../src/server/test-loggers.test-support';
import {
  withEvidenceIngress,
  type EvidenceIngressFixture,
} from './necessary-evidence-ingress.test-support';

setupRitewayBun();
type Operation = 'append' | 'observe' | 'seal' | 'evidence';
function caller(f: EvidenceIngressFixture, policy = captureAdmissionPolicy) {
  const capture = f.f.store.createMediaCaptureOperations({
    admission: policy,
    captureRule,
    sttLagMs: CAPTURE_STT_LAG_MS,
    nextId: createId,
    buildProjection: roundTickProjection(createId),
    evidence: {
      leaseMs: 1000,
      nextToken: () => randomBytes(32).toString('base64url'),
      maxRoundBytes: 1024 * 1024,
      maxGlobalBytes: 4 * 1024 * 1024,
      maxOutstandingIntents: 128,
    },
  });
  let custodyWrites = 0;
  const ingress = createNecessaryEvidenceIngress({
    store: capture,
    custody: {
      ...f.custody,
      seal: (...args) => {
        custodyWrites++;
        return f.custody.seal(...args);
      },
    },
  });
  const authentication = createMediaWorkerAuthentication({
    secret: randomBytes(32).toString('base64url'),
    now: Date.now,
  });
  const handlers = createMediaCaptureHandlers({
    logger: silentLogger,
    reporter: noopErrorReporter,
    authentication: () => authentication,
    capture: () => capture,
    token: async () => {
      throw createAppError('AUTHORIZATION');
    },
    heard: async () => {},
    evidence: ingress.receive,
  });
  const post = (operation: Operation) => {
    const b = f.body;
    const stream = {
      roundId: b.roundId,
      sessionId: b.sessionId,
      workerId: b.workerId,
      epoch: b.epoch,
      segmentId: b.segmentId,
      roundParticipantId: b.roundParticipantId,
    };
    const payload =
      operation === 'evidence'
        ? b
        : operation === 'seal'
          ? { ...stream, expectedChunkCount: 0, framesLost: true }
          : operation === 'observe'
            ? {
                ...stream,
                trackId: b.trackId,
                observedFrom: b.before,
                observedUntil: b.after,
              }
            : {
                ...stream,
                trackId: b.trackId,
                startOffsetMs: b.startOffsetMs,
                durationMs: b.durationMs,
                before: b.before,
                after: b.after,
                text: 'Synthetic capture admission proof',
              };
    const path = `/api/internal/media/${b.roundId}/capture/${operation}`,
      body = JSON.stringify(payload);
    const signed = authentication.sign({ method: 'POST', path, body });
    return handlers.handle(
      new Request(`https://daisy.test${path}`, {
        method: 'POST',
        body,
        headers: {
          'x-daisy-media-signature': signed.signature,
          'x-daisy-media-timestamp': signed.timestamp,
        },
      }),
      operation,
    );
  };
  return { post, custodyWrites: () => custodyWrites };
}
async function rows(f: EvidenceIngressFixture) {
  const [row] = await f.f
    .sql`select (select count(*)::int from transcript_segments where round_id=${f.roundId}) as streams,(select count(*)::int from utterances where round_id=${f.roundId}) as chunks,(select count(*)::int from transcript_observations where round_id=${f.roundId}) as observations,(select count(*)::int from necessary_evidence where original_round_id=${f.roundId}) as evidence,(select coalesce(max(revision),0)::int from round_transcripts where round_id=${f.roundId}) as revision`;
  return row;
}

test('actual signed capture callers recheck closure and epoch after waiting on the Round fence', async () => {
  for (const operation of ['append', 'observe', 'seal', 'evidence'] as const) {
    for (const change of ['closure', 'epoch'] as const) {
      await withEvidenceIngress(async (f) => {
        const receipts: string[] = [];
        const app = caller(f, {
          ...captureAdmissionPolicy,
          closed: (input) => {
            receipts.push(input.now);
            return captureAdmissionPolicy.closed(input);
          },
        });
        const ready = Promise.withResolvers<number>(),
          release = Promise.withResolvers<void>();
        let releasedAt = '';
        const holder = f.f.sql.begin(async (tx) => {
          await tx`select id from rounds where id=${f.roundId} for update`;
          ready.resolve((await tx`select pg_backend_pid() as pid`)[0]!.pid);
          await release.promise;
          if (change === 'closure')
            await tx`update media_sessions set created_at=least(created_at,${new Date(instantMs(f.body.before) - 1000)}),unsafe_at=${new Date(f.body.after)} where id=${f.body.sessionId}`;
          else
            await tx`update media_worker_leases set epoch=epoch+1 where session_id=${f.body.sessionId}`;
          releasedAt = (
            await tx`select clock_timestamp() as now`
          )[0]!.now.toISOString();
        });
        void holder.catch(ready.reject);
        let response: Promise<Response> | undefined;
        try {
          const pid = await ready.promise;
          response = app.post(operation);
          const blocked = await finishedOrBlockedBehind(
            response,
            f.f.sql,
            pid,
            { waits: hostWaits, deadlineMs: 1500 },
          );
          release.resolve();
          await holder;
          const result = await response,
            payload = await result.json();
          const sealAllowed = change === 'closure' && operation === 'seal';
          assert({
            given: `signed ${operation} waiting while session ${change} commits`,
            should:
              'observe committed authority and freshly sampled receipt time, preserve seal-without-capture-time semantics, and leave no provisional effects on refusal',
            actual: {
              blocked,
              status: result.status,
              reply:
                operation === 'evidence'
                  ? payload.kind
                  : sealAllowed
                    ? payload.state
                    : null,
              fresh:
                change === 'epoch'
                  ? receipts.length === 0
                  : receipts.length > 0 &&
                    receipts.every((now) => now >= releasedAt),
              rows: await rows(f),
              custody: app.custodyWrites(),
            },
            expected: {
              blocked: 'blocked',
              status:
                operation === 'evidence' || sealAllowed
                  ? 200
                  : change === 'closure'
                    ? 503
                    : 409,
              reply:
                operation === 'evidence'
                  ? 'refused'
                  : sealAllowed
                    ? 'partial'
                    : null,
              fresh: true,
              rows: {
                streams: sealAllowed ? 1 : 0,
                chunks: 0,
                observations: 0,
                evidence: 0,
                revision: sealAllowed ? 1 : 0,
              },
              custody: 0,
            },
          });
        } finally {
          release.resolve();
          await holder;
          await response?.catch(() => {});
        }
      });
    }
  }
});

test('application admission refusal after capture preparation rolls back signed append and evidence reservation', async () => {
  for (const operation of ['append', 'evidence'] as const)
    await withEvidenceIngress(async (f) => {
      let samples = 0;
      const app = caller(f, {
        ...captureAdmissionPolicy,
        closed: (input) =>
          ++samples === 2 || captureAdmissionPolicy.closed(input),
      });
      const response = await app.post(operation),
        body = await response.json();
      assert({
        given: `signed ${operation} refused at fresh mutation admission after provisional stream/evidence preparation`,
        should:
          'roll back the stream, data, revision and original evidence intent before custody effects',
        actual: [
          samples,
          response.status,
          operation === 'evidence' ? body.kind : null,
          await rows(f),
          app.custodyWrites(),
        ],
        expected: [
          2,
          operation === 'evidence' ? 200 : 409,
          operation === 'evidence' ? 'refused' : null,
          { streams: 0, chunks: 0, observations: 0, evidence: 0, revision: 0 },
          0,
        ],
      });
    });
});
