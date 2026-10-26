import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { createMediaService } from '@daisy/media';
import { createRoundMediaOperations } from '../src/features/round-media/operations';
import {
  withMediaRound,
  tokenClaims,
  delayedMediaCreation,
  waitForMediaFact,
  mediaDependencies,
} from './round-media.test-support';
import { signedCaptureBroker } from './capture-token.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('committed Round session creates actual vendor room before scoped least-privilege mint', async () => {
  await withMediaRound(async (f) => {
    const [host, guest] = await Promise.all([
      f.mediaOperations.session(f.roundId, f.host.actorId),
      f.mediaOperations.session(f.roundId, f.guest.actorId),
    ]);
    const [binding] =
      await f.sql`select room_name from media_sessions where round_id=${f.roundId}`;
    const claims = tokenClaims(host.token);
    assert({
      given: 'concurrent fresh canonical human admissions',
      should:
        'reuse the actual opaque room with distinct private identities and 60s least-privilege tokens',
      actual: [
        await f.media.exists(binding!.room_name),
        host.identity !== guest.identity,
        claims.sub === host.identity,
        claims.exp - claims.nbf >= 59 && claims.exp - claims.nbf <= 60,
        claims.name,
        claims.video,
      ],
      expected: [
        true,
        true,
        true,
        true,
        '',
        {
          roomJoin: true,
          room: binding!.room_name,
          canPublish: true,
          canSubscribe: true,
          canPublishData: false,
          canPublishSources: ['camera', 'microphone'],
          canUpdateOwnMetadata: false,
          hidden: false,
        },
      ],
    });
    await assertRejects({
      given: 'a member outside this Round',
      should: 'refuse media binding before mint',
      code: 'AUTHORIZATION',
      actual: () => f.mediaOperations.session(f.roundId, f.outsider.actorId),
    });
    await f.sql`update users set email_verified=false where id=${f.host.userId}`;
    await assertRejects({
      given: 'canonical account eligibility revoked after an earlier admission',
      should: 'refuse a new token',
      code: 'AUTHORIZATION',
      actual: () => f.mediaOperations.session(f.roundId, f.host.actorId),
    });
    await f.sql`update users set email_verified=true where id=${f.host.userId}`;
    await f.sql`update rounds set status='abandoned',completed_at=clock_timestamp() where id=${f.roundId}`;
    await f.mediaOperations.recoverActiveSessions();
    const [ended] =
      await f.sql`select ended_at from media_sessions where round_id=${f.roundId}`;
    assert({
      given: 'a terminal commit with no connected browser',
      should: 'delete the real room and stamp ended only after absence proof',
      actual: [
        await f.media.exists(binding!.room_name),
        ended!.ended_at !== null,
      ],
      expected: [false, true],
    });
  });
});

test('authenticated capture broker verifies the actual lease and never creates a missing room', async () => {
  await withMediaRound(async (f) => {
    const human = await f.mediaOperations.session(f.roundId, f.host.actorId);
    const [session] =
      await f.sql`select id,room_name from media_sessions where round_id=${f.roundId}`;
    const scope = {
      roundId: f.roundId,
      sessionId: String(session!.id),
      workerId: createId(),
      epoch: 1,
    };
    const { capture, broker, principal } = signedCaptureBroker(f, scope);
    await assertRejects({
      given: 'valid signed identity without a capture lease',
      should: 'refuse token mint',
      code: 'CONFLICT',
      actual: () => broker.captureToken(scope, principal),
    });
    await capture.claimMediaWorkerLease({
      roundId: scope.roundId,
      sessionId: scope.sessionId,
      workerId: scope.workerId,
      leaseMs: 15000,
    });
    const granted = await broker.captureToken(scope, principal);
    const claims = tokenClaims(granted.token);
    assert({
      given: 'an actual safe session and signed exact live worker lease',
      should:
        'mint only hidden subscribe-only capture rights without exposing a human identity',
      actual: [
        claims.exp - claims.nbf >= 59 && claims.exp - claims.nbf <= 60,
        granted.identity !== human.identity,
        claims.video.canPublish,
        claims.video.canSubscribe,
        claims.video.hidden,
        claims.video.canPublishData,
        claims.video.canUpdateOwnMetadata,
        claims.video.canPublishSources,
      ],
      expected: [true, true, false, true, true, false, false, []],
    });
    await assertRejects({
      given: 'a foreign verified worker principal',
      should: 'refuse the mismatched scope',
      code: 'AUTHORIZATION',
      actual: () =>
        broker.captureToken(scope, { ...principal, workerId: createId() }),
    });
    await f.media.deleteRoom(session!.room_name);
    await assertRejects({
      given: 'an authenticated lease but no vendor room',
      should: 'refuse instead of creating a room',
      code: 'INFRASTRUCTURE',
      actual: () => broker.captureToken(scope, principal),
    });
    assert({
      given: 'the refused capture admission',
      should: 'leave the room absent',
      actual: await f.media.exists(session!.room_name),
      expected: false,
    });
  });
});

test('unknown real vendor outcomes survive restart and absence probes until actual late settlement', async () => {
  await withMediaRound(async (f) => {
    const delayed = delayedMediaCreation();
    const reporter: unknown[] = [];
    const operations = createRoundMediaOperations({
      ...mediaDependencies(f, createMediaService({ config: delayed.config })),
      reporter: {
        capture: (error) => {
          reporter.push(error);
        },
      },
    });
    try {
      const joining = operations.session(f.roundId, f.host.actorId);
      const refused = assertRejects({
        given: 'a real creation whose acknowledgement exceeds two seconds',
        should: 'refuse admission and preserve the unresolved operation',
        code: 'INFRASTRUCTURE',
        actual: () => joining,
      });
      await delayed.entered;
      await refused;
      const [session] =
        await f.sql`select id,room_name,unsafe_at from media_sessions where round_id=${f.roundId}`;
      assert({
        given:
          'a timed-out real provider creation with no browser or later scheduler request',
        should:
          'attempt real room cleanup before returning the refused admission',
        actual: await f.media.exists(session!.room_name),
        expected: false,
      });
      const freshProcess = createRoundMediaOperations(mediaDependencies(f));
      await freshProcess.recoverActiveSessions();
      const [unresolved] =
        await f.sql`select unsafe_at,ended_at,(select count(*)::int from media_vendor_mutations where session_id=s.id and settled_at is null) pending from media_sessions s where id=${session!.id}`;
      assert({
        given:
          'restart and a real deletion/absence observation while creation acknowledgement is pending',
        should: 'keep durable uncertainty and refuse to stamp ended',
        actual: [
          unresolved!.unsafe_at !== null,
          unresolved!.ended_at,
          unresolved!.pending,
          reporter.length,
        ],
        expected: [true, null, 1, 1],
      });
      delayed.release();
      await waitForMediaFact(async () => {
        const [pending] =
          await f.sql`select count(*)::int n from media_vendor_mutations where session_id=${session!.id} and settled_at is null`;
        return pending!.n === 0;
      });
      await freshProcess.recoverActiveSessions();
      const [safe] =
        await f.sql`select unsafe_at,ended_at,deletion_requested_at from media_sessions where id=${session!.id}`;
      assert({
        given:
          'actual delayed acknowledgement followed by another fresh absence proof',
        should:
          'recover the session, end the episode so capture discovery resumes (ISSUE-465), and invent no Round terminal result',
        actual: [
          safe!.unsafe_at,
          safe!.ended_at,
          safe!.deletion_requested_at,
          await f.media.exists(session!.room_name),
        ],
        expected: [null, null, null, false],
      });
    } finally {
      delayed.release();
      delayed.stop();
    }
  });
});
