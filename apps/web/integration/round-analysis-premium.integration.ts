import {
  captureRule,
  readRoundOpening,
  roundWaitingOn,
} from '@daisy/debate-engine';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { randomBytes } from 'node:crypto';
import {
  withRoomRuntime,
  launchRuntimeRound,
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
import { canUseRoundAnalysis } from '../src/features/round-analysis/authorization';
import { createRoundAnalysisOperations } from '../src/features/round-analysis/operations';
import { roundAnalysisView } from '../src/features/round-analysis/policy';
import {
  canReadRound,
  canReadTranscript,
} from '../src/features/round-runtime/reads';
setupRitewayBun();
requireTestServices(process.env);

test('only an explicit authorized request runs analysis, and delivered reports survive lapse without changing ballots', async () => {
  await withRoomRuntime(
    async (f) => {
      const room = await f.assemble();
      const { roundId } = await launchRuntimeRound(f, room);
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
      const now = await f.store.databaseNow();
      const scan = () =>
        f.store
          .scanRoundAnalysisJobs(64)
          .then((seats) => seats.map((s) => s.roundParticipantId));
      const request = (caller = f.host) =>
        f.store.requestRoundAnalysis({
          roundId,
          caller,
          authorize: (access) =>
            canUseRoundAnalysis(access, 'round.analysis.request'),
        });
      let calls = 0;
      const hostSeat = { roundId, roundParticipantId: seat.id };
      const analyse = () =>
        createRoundAnalysisOperations({
          store: f.store,
          withProvider: (_signal, work) => work(),
          voice: () => ({
            complete: async () => {
              calls++;
              return {
                text: JSON.stringify(sampleRoundAnalysisReport),
                finish: 'stop' as const,
                refused: false,
                promptTokens: 1,
                completionTokens: 1,
              };
            },
          }),
        }).analyse(hostSeat, new AbortController().signal);
      assert({
        given: 'a completed Round without an explicit request',
        should: 'never enqueue its seat for an analysis',
        actual: (await scan()).includes(seat.id),
        expected: false,
      });
      await analyse();
      const [before] =
        await f.sql`select count(*)::int as rows from round_analyses where round_id=${roundId}`;
      assert({
        given: 'a direct worker attempt without a request',
        should: 'spend no lease, attempt or provider call',
        actual: [before!.rows, calls],
        expected: [0, 0],
      });
      await assertRejects({
        given: 'a member who did not debate requesting private analysis',
        should: 'refuse without creating work',
        actual: () => request(f.outsider),
        code: 'NOT_FOUND',
      });
      const admitted = await request();
      assert({
        given: 'the authenticated debater requesting analysis twice',
        should: 'reuse exactly one admitted identity',
        actual: await request(),
        expected: admitted,
      });
      const discovery = {
        work: null as Promise<string[]> | null,
        ordering: '',
      };
      await f.sql.begin(async (holder) => {
        await holder`select id from users where id=${f.host.userId} for update`;
        const [backend] = await holder`select pg_backend_pid() as pid`;
        discovery.work = scan();
        discovery.ordering = await finishedOrBlockedBehind(
          discovery.work,
          f.sql,
          Number(backend!.pid),
          { now: Date.now },
        );
      });
      await discovery.work;
      assert({
        given: 'another writer holding a debater account fence',
        should:
          'scan only already-admitted work without acquiring cross-round account locks',
        actual: [discovery.ordering, (await scan()).includes(seat.id)],
        expected: ['finished', true],
      });
      await f.sql`delete from account_entitlement_grants where user_id=${f.host.userId}`;
      await analyse();
      const ballotRead = () =>
        f.store.readRoundBallot({
          readOpening: readRoundOpening,
          decideWaitingOn: roundWaitingOn,
          captureRule,
          roundId,
          caller: f.host,
          authorize: (r, a) => canReadRound(f.host, r, a),
          authorizeTranscript: (r, a) => canReadTranscript(f.host, r, a),
        });
      const withPremium = JSON.stringify(await ballotRead());
      await f.sql`delete from account_entitlement_grants where user_id=${f.host.userId}`;
      const withoutPremium = JSON.stringify(await ballotRead());
      const authorizeRead = (
        access: Parameters<typeof canUseRoundAnalysis>[0],
      ) => canUseRoundAnalysis(access, 'round.analysis.read');
      await assertRejects({
        given: 'a member who did not debate the Round reading its analysis',
        should: 'refuse with NOT_FOUND: only a seated debater has one',
        actual: () =>
          f.store.readRoundAnalysis({
            roundId,
            caller: f.outsider,
            authorize: authorizeRead,
          }),
        code: 'NOT_FOUND',
      });
      const own = await f.store.readRoundAnalysis({
        roundId,
        caller: f.host,
        authorize: authorizeRead,
      });
      assert({
        given:
          'the authorized debater after all grants lapse and generation is disabled',
        should: 'read the delivered report without a new call or grant',
        actual: [
          roundAnalysisView({
            facts: own.facts,
            allowance: own.allowance,
            enabled: false,
            now,
          }),
          calls,
        ],
        expected: [{ status: 'ready', report: sampleRoundAnalysisReport }, 1],
      });
      await f.sql`delete from account_age where user_id=${f.host.userId}`;
      await assertRejects({
        given:
          'a once-authorized debater whose durable participant admission is gone',
        should: 'refuse the private report despite a retained seat and report',
        actual: () =>
          f.store.readRoundAnalysis({
            roundId,
            caller: f.host,
            authorize: authorizeRead,
          }),
        code: 'NOT_FOUND',
      });
      assert({
        given:
          'a stored round analysis, then the same ballot read with and without the premium grant',
        should:
          'make one paid call, store the report for the debater’s own seat, and leave the ballot read identical',
        actual: {
          calls,
          report:
            own.facts.analysis?.kind === 'succeeded'
              ? own.facts.analysis.report.summary
              : null,
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
        capacity: 8,
        leaseMs: 30000,
        model: 'fixture',
        nextToken: () => randomBytes(32).toString('base64url'),
      },
    },
  );
});
