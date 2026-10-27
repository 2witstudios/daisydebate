import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { withFixture } from './constraint-helpers';
import {
  mediaTestHuman,
  mediaTestStore,
  mediaTestTick,
} from './media-session.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

for (const failure of [
  'pending',
  'owner',
  'epoch',
  'horizon',
  'none',
  'terminal',
] as const) {
  test(`rotation preserves session evidence and checks the absence fence: ${failure}`, async () => {
    await withFixture(databaseUrl, async (f) => {
      const { roundId, seat } = await mediaTestHuman(f);
      const store = mediaTestStore(f.sql);
      const binding = await store.ensureBinding({
        roundId,
        actorId: seat.actorId,
        buildProjection: mediaTestTick,
      });
      const judge = await f.seat(roundId, 'judge');
      await f.sql`update users set email_verified=true where id=(select user_id from actors where id=${judge.actorId})`;
      await store.ensureBinding({
        roundId,
        actorId: judge.actorId,
        buildProjection: mediaTestTick,
      });
      try {
        const claim = await store.claimMediaReconcile({
          sessionId: binding.sessionId,
          owner: createId(),
        });
        if (claim.kind !== 'claimed') throw new Error('Expected initial claim');
        const mutation = await store.beginMediaMutation({
          ...claim.fence,
          intent: { kind: 'delete', identity: null, payload: {} },
          buildProjection: mediaTestTick,
          authorize: () => undefined,
        });
        await f.sql`insert into media_worker_leases(session_id,worker_id,epoch,expires_at) values(${binding.sessionId},${createId()},1,clock_timestamp()+interval '15 seconds')`;
        await f.sql`update users set email_verified=false where id=(select user_id from actors where id=${judge.actorId})`;
        if (failure !== 'pending')
          await store.settleMediaMutation(mutation, 'succeeded');
        const proof = await store.prepareMediaAbsenceProof(claim.fence);
        if (failure === 'terminal')
          await f.sql`update rounds set status='abandoned',completed_at=clock_timestamp() where id=${roundId}`;
        const absenceProof = proof && {
          ...proof,
          ...(failure === 'owner' ? { owner: createId() } : {}),
          ...(failure === 'epoch' ? { epoch: proof.epoch + 1 } : {}),
          ...(failure === 'horizon'
            ? { settledMutationCount: proof.settledMutationCount - 1 }
            : {}),
        };
        await store.finishMediaReconcile({ ...claim.fence, absenceProof });
        const [session] =
          await f.sql`select id, room_name, ended_at from media_sessions where id=${binding.sessionId}`;
        const [lease] =
          await f.sql`select epoch,expires_at<=clock_timestamp() as expired from media_worker_leases where session_id=${binding.sessionId}`;
        const bindings =
          await f.sql`select round_participant_id from media_participants where session_id=${binding.sessionId}`;
        const [journal] =
          await f.sql`select count(*)::int as count from media_vendor_mutations where session_id=${binding.sessionId}`;
        const rotated = failure === 'none';
        assert({
          given: `revoked bound judge and ${failure} proof condition`,
          should:
            'rotate only behind the exact settled nonterminal fence, retaining session and journal',
          actual: [
            session!.id,
            session!.room_name !== binding.roomName,
            lease!.epoch,
            lease!.expired,
            bindings.some((row) => row.round_participant_id === judge.id),
            bindings.some((row) => row.round_participant_id === seat.id),
            journal!.count,
          ],
          expected: [
            binding.sessionId,
            rotated,
            rotated ? 2 : 1,
            rotated,
            !rotated,
            true,
            1,
          ],
        });
        await assertRejects({
          given: 'the revoked judge after reconciliation',
          should: 'refuse rebinding',
          code: 'AUTHORIZATION',
          actual: () =>
            store.ensureBinding({
              roundId,
              actorId: judge.actorId,
              buildProjection: mediaTestTick,
            }),
        });
      } finally {
        await f.sql`delete from media_sessions where id=${binding.sessionId}`;
      }
    });
  });
}
