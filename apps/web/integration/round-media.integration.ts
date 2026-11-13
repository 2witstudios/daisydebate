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
  mediaDependencies,
  waitForMediaFact,
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
    await f.sql`update rounds set status='abandoned',current_stage=null,completed_at=clock_timestamp() where id=${f.roundId}`;
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

test('an unknown real vendor outcome is fenced by retirement, and its late settlement changes nothing', async () => {
  await withMediaRound(async (f) => {
    const delayed = delayedMediaCreation();
    const reporter: unknown[] = [];
    const lateSettlement = Promise.withResolvers<void>();
    const deps = mediaDependencies(
      f,
      createMediaService({ config: delayed.config }),
    );
    const operations = createRoundMediaOperations({
      ...deps,
      store: {
        ...deps.store,
        settleMediaMutation: async (...args) => {
          await deps.store.settleMediaMutation(...args);
          lateSettlement.resolve();
        },
      },
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
      const [first] =
        await f.sql`select id,room_name from media_sessions where round_id=${f.roundId}`;
      await refused;
      const [session] =
        await f.sql`select id,room_name,unsafe_at,ended_at from media_sessions where id=${first!.id}`;
      const [journal] =
        await f.sql`select outcome from media_vendor_mutations where session_id=${first!.id} and kind='create' order by dispatched_at limit 1`;
      assert({
        given:
          'a real creation unanswered past its deadline, with its room then observed absent',
        should:
          'retire the room, mark the creation superseded and invent no Round end',
        actual: [
          await f.media.exists(first!.room_name),
          session!.room_name !== first!.room_name,
          session!.unsafe_at,
          session!.ended_at,
          journal!.outcome,
          reporter.length,
        ],
        expected: [false, true, null, null, 'superseded', 1],
      });
      delayed.release();
      await lateSettlement.promise;
      const [settled] =
        await f.sql`select outcome from media_vendor_mutations where session_id=${first!.id} and kind='create' order by dispatched_at limit 1`;
      assert({
        given: 'the actual delayed acknowledgement arriving afterwards',
        should: 'not rewrite the superseded outcome',
        actual: settled!.outcome,
        expected: 'superseded',
      });
    } finally {
      delayed.release();
      delayed.stop();
    }
  });
});

test('a completed Round with the call chosen moves to a real fresh room only its people can join, then ends once empty', async () => {
  await withMediaRound(async (f) => {
    await f.sql`update rounds set post_round_call=true where id=${f.roundId}`;
    await f.mediaOperations.session(f.roundId, f.host.actorId);
    const [before] =
      await f.sql`select room_name from media_sessions where round_id=${f.roundId}`;
    await f.sql`update rounds set status='completed',current_stage=null,started_at=coalesce(started_at,created_at),completed_at=clock_timestamp() where id=${f.roundId}`;
    const session = async () =>
      (
        await f.sql`select room_name, ended_at, post_round_call_opened_at as opened_at from media_sessions where round_id=${f.roundId}`
      )[0]!;
    // A pass may wait out the minimum interval since the admission's own.
    await waitForMediaFact(async () => {
      await f.mediaOperations.recoverActiveSessions();
      return (await session()).opened_at !== null;
    });
    const opened = await session();
    assert({
      given: 'the Round completing with its host in the room',
      should:
        'delete the Round’s real room and name a new one, with the session still open',
      actual: [
        await f.media.exists(before!.room_name),
        opened.room_name === before!.room_name,
        opened.ended_at,
      ],
      expected: [false, false, null],
    });
    const joined = await waitForAdmission(() =>
      f.mediaOperations.session(f.roundId, f.host.actorId),
    );
    const claims = tokenClaims(joined.token);
    assert({
      given: 'the host joining the call',
      should:
        'create the call’s real room and sign a visible camera-and-microphone token for it alone',
      actual: [
        await f.media.exists(opened.room_name),
        claims.video.room,
        claims.video.hidden,
        claims.video.canPublishSources,
        joined.mediaRoomName,
      ],
      expected: [
        true,
        opened.room_name,
        false,
        ['camera', 'microphone'],
        opened.room_name,
      ],
    });
    await f.sql`update media_sessions set room_vacant_since=clock_timestamp()-interval '61 seconds' where round_id=${f.roundId}`;
    await waitForMediaFact(async () => {
      await f.mediaOperations.recoverActiveSessions();
      return (await session()).ended_at !== null;
    });
    assert({
      given: 'the call’s room read empty past the grace',
      should: 'delete the real room and end the session',
      actual: [
        await f.media.exists(opened.room_name),
        (await session()).ended_at !== null,
      ],
      expected: [false, true],
    });
    await assertRejects({
      given: 'an admission after the call ended',
      should: 'refuse it for good',
      code: 'CONFLICT',
      actual: () => f.mediaOperations.session(f.roundId, f.host.actorId),
    });
  });
});

/** An admission retried while a pass still holds the session. */
async function waitForAdmission<T>(admit: () => Promise<T>): Promise<T> {
  let admitted: T | undefined;
  await waitForMediaFact(async () => {
    try {
      admitted = await admit();
      return true;
    } catch {
      return false;
    }
  });
  return admitted as T;
}
