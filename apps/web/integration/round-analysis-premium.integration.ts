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
import { sampleRoundAnalysisReport } from '@daisy/protocol/round-analysis-testing';
import { canGenerateRoundAnalysis } from '../src/features/round-analysis/authorization';
import { createRoundAnalysisOperations } from '../src/features/round-analysis/operations';
import {
  canReadRound,
  canReadTranscript,
} from '../src/features/round-runtime/reads';
setupRitewayBun();
requireTestServices(process.env);

test('round analysis discovery and claims use the seat account’s own entitlement grant, and never change the ballot read', async () => {
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
      await f.sql`insert into utterances(id,round_id,segment_id,round_participant_id,sequence,text) values (${createId()},${roundId},${segment.id},${seat.id},0,'Captured fixture speech for analysis')`;
      await f.sql`insert into round_transcripts(round_id,revision) values (${roundId},1) on conflict (round_id) do update set revision=1`;
      await finalizeAsWeb(f, roundId);
      await seedSettledAttendanceLedger(f, roundId);
      await finalizeByMaintenance(f, roundId);
      const since = new Date(Date.now() - 60_000).toISOString();
      const scan = (grant: boolean) =>
        f.store
          .scanRoundAnalysisJobs(64, since, (access) =>
            canGenerateRoundAnalysis(access, grant),
          )
          .then((seats) => seats.map((s) => s.roundParticipantId));
      let calls = 0;
      const hostSeat = { roundId, roundParticipantId: seat.id };
      const analyse = (grant: boolean) =>
        createRoundAnalysisOperations({
          store: f.store,
          betaGrantsPremium: grant,
          now: () => new Date().toISOString(),
          withProvider: (_signal, work) => work(),
          voice: () => ({
            complete: async () => {
              calls++;
              return {
                text: JSON.stringify(sampleRoundAnalysisReport),
                promptTokens: 1,
                completionTokens: 1,
              };
            },
          }),
        }).analyse(hostSeat, new AbortController().signal);
      assert({
        given: 'a completed round and launch policy with no beta premium',
        should: 'never enqueue its seat for an analysis',
        actual: (await scan(false)).includes(seat.id),
        expected: false,
      });
      await analyse(false);
      const [before] =
        await f.sql`select count(*)::int as rows from round_analyses where round_id=${roundId}`;
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
        given:
          'a debater holding a beta round analysis grant, with the beta grant counting',
        should: 'discover their seat',
        actual: (await scan(true)).includes(seat.id),
        expected: true,
      });
      await f.sql`delete from account_entitlement_grants where user_id=${f.host.userId} and entitlement='round_analysis'`;
      await analyse(true);
      assert({
        given:
          'the round analysis grant removed after discovery but before the claim, beta state still approved',
        should: 'reevaluate the seat’s own grant facts and buy no call',
        actual: calls,
        expected: 0,
      });
      await f.sql`insert into account_entitlement_grants(user_id,entitlement,source) values (${f.host.userId},'round_analysis','beta')`;
      await analyse(true);
      const ballotRead = () =>
        f.store.readRoundBallot({
          roundId,
          caller: f.host,
          authorize: (r, a) => canReadRound(f.host, r, a),
          authorizeTranscript: (r, a) => canReadTranscript(f.host, r, a),
        });
      const withPremium = JSON.stringify(await ballotRead());
      await f.sql`delete from account_entitlement_grants where user_id=${f.host.userId}`;
      const withoutPremium = JSON.stringify(await ballotRead());
      const own = await f.store.readRoundAnalysis({
        roundId,
        caller: f.host,
      });
      assert({
        given:
          'a stored round analysis, then the same ballot read with and without the premium grant',
        should:
          'make one paid call, store the report for the debater’s own seat, and leave the ballot read identical',
        actual: {
          calls,
          report: own.facts.analysis?.report?.summary,
          identical: withPremium === withoutPremium,
          analysisInBallotRead: Object.keys(JSON.parse(withPremium)).filter(
            (key) => /analysis|coaching/i.test(key),
          ),
        },
        expected: {
          calls: 1,
          report: sampleRoundAnalysisReport.summary,
          identical: true,
          analysisInBallotRead: [],
        },
      });
    },
    {
      roundAnalysis: {
        leaseMs: 30000,
        model: 'fixture',
        nextToken: () => randomBytes(32).toString('base64url'),
      },
    },
  );
});
