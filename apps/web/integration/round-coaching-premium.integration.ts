import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { randomBytes } from 'node:crypto';
import {
  withRoomRuntime,
  startRuntimeRound,
} from './round-runtime.test-support';
import { playOut } from './round-judging.test-support';
import { roundTickProjection } from '../src/features/round-finalization/operations';
import {
  finalizeAsWeb,
  finalizeByMaintenance,
} from './round-maintenance.test-support';
import { seedSettledAttendanceLedger } from './round-attendance-fixture.test-support';
import { finishedOrBlockedBehind } from '@daisy/db/testing';
import {
  canGenerateCoaching,
  canCoach,
} from '../src/features/round-coaching/authorization';
import { createRoundCoachingOperations } from '../src/features/round-coaching/operations';
import {
  canReadRound,
  canReadTranscript,
} from '../src/features/round-runtime/reads';
setupRitewayBun();
requireTestServices(process.env);

test('premium coaching discovery, claims and reads use current beta entitlement', async () => {
  await withRoomRuntime(
    async (f) => {
      const room = await f.assemble();
      const { roundId } = await startRuntimeRound(f, room);
      await playOut(f, roundId, false);
      await f.store.executeRoundTick({
        roundId,
        buildProjection: roundTickProjection(createId),
      });
      const round = (await f.store.getRound(roundId))!;
      const segment = round.segments[0]!;
      const seat = round.participants.find(
        (p) => p.actorId === f.host.actorId,
      )!;
      await f.sql`insert into utterances(id,round_id,segment_id,round_participant_id,sequence,text) values (${createId()},${roundId},${segment.id},${seat.id},0,'Captured fixture speech for coaching')`;
      await f.sql`insert into round_transcripts(round_id,revision) values (${roundId},1) on conflict (round_id) do update set revision=1`;
      await finalizeAsWeb(f, roundId);
      await seedSettledAttendanceLedger(f, roundId);
      await finalizeByMaintenance(f, roundId);
      const since = new Date(Date.now() - 60_000).toISOString();
      const scan = (grant: boolean) =>
        f.store.scanRoundFeedbackJobs(64, since, (access) =>
          canGenerateCoaching(access, grant),
        );
      let calls = 0;
      const coach = (grant: boolean) =>
        createRoundCoachingOperations({
          store: f.store,
          betaGrantsPremium: grant,
          now: () => new Date().toISOString(),
          withProvider: (_signal, work) => work(),
          voice: () => ({
            complete: async () => {
              calls++;
              return {
                text: JSON.stringify({
                  affirmative: 'Weigh access.',
                  negative: 'Answer the turn.',
                }),
                promptTokens: 1,
                completionTokens: 1,
              };
            },
          }),
        }).coach(roundId, new AbortController().signal);
      assert({
        given: 'a completed round and launch policy with no beta premium',
        should: 'never enqueue it for coaching',
        actual: (await scan(false)).includes(roundId),
        expected: false,
      });
      await coach(false);
      const [before] =
        await f.sql`select count(*)::int as rows from round_feedback where round_id=${roundId}`;
      assert({
        given: 'a direct worker attempt without premium',
        should: 'spend no lease, attempt or provider call',
        actual: [before!.rows, calls],
        expected: [0, 0],
      });
      const discovery = {
        work: null as Promise<string[]> | null,
        ordering: '',
      };
      await f.sql.begin(async (holder) => {
        await holder`select id from users where id=${f.host.userId} for update`;
        const [backend] = await holder`select pg_backend_pid() as pid`;
        discovery.work = scan(true);
        discovery.ordering = await finishedOrBlockedBehind(
          discovery.work,
          f.sql,
          Number(backend!.pid),
          { now: Date.now },
        );
      });
      await discovery.work;
      assert({
        given: 'another writer holds a debater account fence',
        should:
          'finish advisory discovery without taking cross-round account locks',
        actual: discovery.ordering,
        expected: 'finished',
      });
      assert({
        given: 'approved beta debaters and the beta premium grant',
        should: 'discover the entitled round',
        actual: (await scan(true)).includes(roundId),
        expected: true,
      });
      await f.sql`update account_beta_access set state='revoked',revision=revision+1 where user_id in (${f.host.userId},${f.guest.userId})`;
      await coach(true);
      assert({
        given: 'access revoked after discovery but before the claim',
        should: 'reevaluate the canonical account facts and buy no call',
        actual: calls,
        expected: 0,
      });
      await f.sql`update account_beta_access set state='approved',revision=revision+1 where user_id in (${f.host.userId},${f.guest.userId})`;
      await coach(true);
      const read = (grant: boolean) =>
        f.store.readRoundBallot({
          roundId,
          caller: f.host,
          authorize: (r, a) => canReadRound(f.host, r, a),
          authorizeTranscript: (r, a) => canReadTranscript(f.host, r, a),
          authorizeCoaching: (r, a) =>
            canCoach(
              a,
              {
                kind: 'round',
                roundId: r.id,
                createdByActorId: r.hostActorId,
                visibility: r.visibility,
                status: r.status,
                revision: r.version,
                participants: r.participants,
              },
              grant,
              'round.coaching.read',
            ),
        });
      const entitled = await read(true),
        ordinary = await read(false);
      assert({
        given:
          'stored premium coaching and a fresh read with the beta grant disabled',
        should: 'withhold coaching while preserving the official round result',
        actual: {
          calls,
          entitled: entitled.coaching?.facts.pass?.feedback?.affirmative,
          ordinary: ordinary.coaching,
          status: ordinary.read.round.status,
          outcome: ordinary.read.round.outcome,
        },
        expected: {
          calls: 1,
          entitled: 'Weigh access.',
          ordinary: null,
          status: 'completed',
          outcome: null,
        },
      });
    },
    {
      coaching: {
        leaseMs: 30000,
        model: 'fixture',
        nextToken: () => randomBytes(32).toString('base64url'),
      },
    },
  );
});
