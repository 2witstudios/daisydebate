import { buildDebateTopic } from '@daisy/protocol';
import { finalizeAsWeb } from './round-maintenance.test-support';
import { assembleJudgedRoom } from './round-judges.test-support';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  startRuntimeRound,
  withRoomRuntime,
} from './round-runtime.test-support';
setupRitewayBun();
requireTestServices(process.env);

for (const revoked of [false, true])
  test(`actual finalization queues every eligible assigned bot judge: revoked=${revoked}`, async () =>
    withRoomRuntime(
      async (f) => {
        const bots = [createId(), createId()];
        let roundId: string | undefined, roomId: string | undefined;
        try {
          for (const actorId of bots) {
            await f.sql`insert into actors(id,kind) values(${actorId},'bot')`;
            await f.sql`insert into bot_profiles(actor_id,name,persona,voice) values(${actorId},'Finalizer judge fixture','Test','aura-2-thalia-en')`;
          }
          let room = await assembleJudgedRoom(f, 2);
          roomId = room.id;
          for (const [slot, actorId] of bots.entries())
            room = (
              await f.command(f.host, room, {
                type: 'assign-seat',
                actorId,
                role: 'judge',
                slot,
              })
            ).view;
          for (const who of [f.host, f.guest])
            room = (
              await f.consent(
                who,
                await f.operations.view(who, room.id),
                'ready',
              )
            ).view;
          ({ roundId } = await startRuntimeRound(f, room));
          const round = (await f.store.getRound(roundId))!;
          if (revoked)
            await f.sql`delete from bot_profiles where actor_id=${bots[1]!}`;
          await f.sql`update rounds set started_at=clock_timestamp()-interval '20 minutes' where id=${roundId}`;
          const result = await finalizeAsWeb(f, roundId);
          await finalizeAsWeb(f, roundId);
          const jobs =
            await f.sql`select judge_participant_id,freeze_revision,status,attempts from round_judging_jobs where round_id=${roundId} order by judge_participant_id`;
          const expected = round.participants
            .filter(
              (p) => p.role === 'judge' && (!revoked || p.actorId !== bots[1]),
            )
            .map((p) => ({
              judge_participant_id: p.id,
              freeze_revision: 1,
              status: 'queued',
              attempts: 0,
            }))
            .sort((a, b) =>
              a.judge_participant_id.localeCompare(b.judge_participant_id),
            );
          assert({
            given:
              'an actual publicly admitted2botjudge Room with missing capture streams and canonical profile eligibility',
            should:
              'atomically freeze truthful input and create exactlyone queued intent for each currently eligible assigned judge on retry',
            actual: {
              status: result.status,
              completeness:
                result.status === 'frozen' ? result.freeze.completeness : null,
              jobs: [...jobs],
              runs: (
                await f.sql`select id from agent_runs where round_participant_id in (select id from round_participants where round_id=${roundId})`
              ).length,
            },
            expected: {
              status: 'frozen',
              completeness: 'incomplete',
              jobs: expected,
              runs: 0,
            },
          });
        } finally {
          if (roundId) {
            await f.sql`delete from outbox where topic=${buildDebateTopic(roundId)}`;
            await f.sql`delete from rounds where id=${roundId}`;
          }
          if (roomId) {
            await f.sql`delete from outbox where topic=${`room:${roomId}`}`;
            await f.sql`delete from rooms where id=${roomId}`;
          }
          for (const actorId of bots) {
            await f.sql`delete from bot_profiles where actor_id=${actorId}`;
            await f.sql`delete from actors where id=${actorId}`;
          }
        }
      },
      { botBusyCap: 4 },
    ));
