import { openWebDatabase } from '../src/server/database';
import { hostWaits } from '@daisy/worker/host';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { createAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { decisionRelease } from '../src/features/notifications/decision-release';
import { createRoundRuntimeOperations } from '../src/features/round-runtime/operations';
import { readyTwoHumanJudgeRoom } from './round-judging.test-support';
import {
  launchRuntimeRound,
  withRoomRuntime,
} from './round-runtime.test-support';

setupRitewayBun();

test('actual finalization keeps app selection and notification obligation atomic through refusal and replay', async () => {
  let stage: 'release' | 'audience' | 'accept' = 'release';
  let releases = 0,
    audiences = 0;
  const failure = new Error('Controlled audience selection failure');
  await withRoomRuntime(
    async (f) => {
      const { room, judges } = await readyTwoHumanJudgeRoom(f);
      const { roundId, operations, principal } = await launchRuntimeRound(
        f,
        room,
      );
      const initial = (await f.store.getRound(roundId))!;
      const participant = initial.participants.find(
        (p) => p.actorId === f.host.actorId,
      )!;
      const envelope = {
        version: 1 as const,
        commandId: createId(),
        expectedVersion: initial.version,
        command: { type: 'forfeit' as const, participantId: participant.id },
      };
      const state = async () => {
        const [row] = await f.sql`select jsonb_build_object(
        'round',(select to_jsonb(r) from rounds r where id=${roundId}),
        'commands',(select jsonb_agg(to_jsonb(c) order by command_id) from round_commands c where round_id=${roundId}),
        'notifications',(select jsonb_agg(to_jsonb(n) order by id) from notifications n where round_id=${roundId}),
        'finalizations',(select jsonb_agg(to_jsonb(z) order by command_id) from round_finalizations z where round_id=${roundId})
      ) state`;
        return row.state;
      };
      const before = await state();
      await assertRejects({
        given: 'application release refusal inside actual forfeit finalization',
        should: 'roll back completion and notification obligation together',
        actual: () => operations.command(principal, roundId, envelope),
        code: 'CONFLICT',
      });
      assert({
        given: 'release refusal',
        should: 'read no audience and leave all durable state unchanged',
        actual: [releases, audiences, await state()],
        expected: [1, 0, before],
      });
      stage = 'audience';
      assert({
        given:
          'application audience exception after the provisional completion',
        should:
          'propagate the same exception and roll back notification and completion',
        actual: [
          await operations.command(principal, roundId, envelope).then(
            () => false,
            (error: unknown) => error === failure,
          ),
          await state(),
        ],
        expected: [true, before],
      });
      const unconfigured = openWebDatabase({
        waits: hostWaits,
        url: requireTestServices(process.env).databaseUrl,
        nextActorId: createId,
      });
      try {
        await assertRejects({
          given: 'a database client without an application release capability',
          should:
            'refuse completion rather than defaulting a policy or losing its obligation',
          actual: () =>
            createRoundRuntimeOperations({
              store: unconfigured,
              nextSegmentId: createId,
            }).command(principal, roundId, envelope),
          code: 'INVARIANT',
        });
        assert({
          given: 'missing application capability',
          should: 'leave the provisional Round and receipt unchanged',
          actual: await state(),
          expected: before,
        });
      } finally {
        await unconfigured.close();
      }
      // The cast remains current, but this account may no longer receive a notification.
      await f.sql`update users set deleted_at=clock_timestamp() where id=${judges[1]!.userId}`;
      stage = 'accept';
      const receipt = await operations.command(principal, roundId, envelope);
      const calls = [releases, audiences];
      const replay = await operations.command(principal, roundId, envelope);
      const recipients = await f.sql<
        { user_id: string; actor_id: string }[]
      >`select user_id,actor_id from notifications where round_id=${roundId} and kind='round_decision_released' order by user_id`;
      assert({
        given:
          'actual finalization with a judge erased, then identical command replay',
        should:
          'complete once, tell only current live accounts and never reselect on replay',
        actual: [
          (await f.store.getRound(roundId))!.status,
          receipt.resultingVersion,
          replay.resultingVersion,
          replay.replayed,
          recipients.map((r) => r.user_id).sort(),
          [releases, audiences],
        ],
        expected: [
          'completed',
          initial.version + 1,
          initial.version + 1,
          true,
          [f.host.userId, f.guest.userId, judges[0]!.userId].sort(),
          calls,
        ],
      });
    },
    {
      decisionRelease: {
        release: (policy) => {
          releases++;
          if (stage === 'release') throw createAppError('CONFLICT');
          return decisionRelease.release(policy);
        },
        audience: (facts) => {
          audiences++;
          if (stage === 'audience') throw failure;
          return decisionRelease.audience(facts);
        },
      },
    },
  );
});

test('actual held finalization completes without reading audience or owing notifications', async () => {
  let audiences = 0;
  await withRoomRuntime(
    async (f) => {
      const { room } = await readyTwoHumanJudgeRoom(f);
      const { roundId, operations, principal } = await launchRuntimeRound(
        f,
        room,
      );
      await f.sql`update rounds set decision_release='held' where id=${roundId}`;
      const initial = (await f.store.getRound(roundId))!;
      const participant = initial.participants.find(
        (p) => p.actorId === f.host.actorId,
      )!;
      await operations.command(principal, roundId, {
        version: 1,
        commandId: createId(),
        expectedVersion: initial.version,
        command: { type: 'forfeit', participantId: participant.id },
      });
      const [owed] =
        await f.sql`select count(*)::int as n from notifications where round_id=${roundId} and kind='round_decision_released'`;
      assert({
        given: 'held policy on a real finalization',
        should:
          'commit the decision with no default notification or audience selection',
        actual: [(await f.store.getRound(roundId))!.status, owed.n, audiences],
        expected: ['completed', 0, 0],
      });
    },
    {
      decisionRelease: {
        release: decisionRelease.release,
        audience: () => {
          audiences++;
          throw Error('A held decision never reads its audience');
        },
      },
    },
  );
});
