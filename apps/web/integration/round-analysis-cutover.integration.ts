// Predecessor cutover evidence: actual old operation/provider with a controlled fetch edge.
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { activeRoomMembers, closeRoom, eraseSeats } from '@daisy/debate-engine';
import { subjectRightsVerificationBindings } from '@daisy/db/privacy';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { randomBytes } from 'node:crypto';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { sampleRoundAnalysisReport } from '@daisy/protocol/round-analysis-testing';
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
setupRitewayBun();
requireTestServices(process.env);

for (const mode of [
  'clear-only',
  'erase-only',
  'drain',
  'terminate',
] as const) {
  test(`predecessor paused analysis cutover: ${mode}`, async () => {
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
        const target = { roundId, roundParticipantId: seat.id };
        await f.sql`insert into utterances(id,round_id,segment_id,round_participant_id,sequence,text) values (${createId()},${roundId},${segment.id},${seat.id},0,'Captured fixture speech for analysis')`;
        await f.sql`insert into round_transcripts(round_id,revision) values (${roundId},1) on conflict (round_id) do update set revision=1`;
        await finalizeAsWeb(f, roundId);
        await seedSettledAttendanceLedger(f, roundId);
        await finalizeByMaintenance(f, roundId);
        const claim = await f.store.claimRoundAnalysisJob(
          target,
          () => 'claim',
        );
        if (!claim) throw Error('Expected actual predecessor claim');
        const child = Bun.spawn(
          [
            process.execPath,
            new URL(
              './round-analysis-cutover-process.test-support.ts',
              import.meta.url,
            ).pathname,
          ],
          {
            stdin: 'pipe',
            stdout: 'pipe',
            stderr: 'pipe',
            timeout: 5000,
          },
        );
        const errors = new Response(child.stderr).text();
        const claimed = Promise.withResolvers<void>();
        const events: string[] = [];
        const stdout = createInterface({
          input: Readable.from(child.stdout),
        });
        const read = (async () => {
          for await (const event of stdout) {
            events.push(event);
            if (event === 'claimed') claimed.resolve();
          }
        })();
        void read.catch(claimed.reject);
        const exitedEarly = child.exited.then(() => {
          if (!events.includes('claimed'))
            throw Error('Child never reached claim boundary');
        });
        try {
          child.stdin.write(`${JSON.stringify(claim)}\n`);
          await Promise.race([claimed.promise, exitedEarly]);
          if (mode === 'erase-only') {
            await f.store.erasePrivacySubject(
              {
                subject: f.host,
                now: await f.store.databaseNow(),
                vendors: [],
                jobIds: [],
              },
              { closeRoom, eraseSeats, activeRoomMembers },
              subjectRightsVerificationBindings,
            );
          } else {
            await f.sql`update round_analyses set status='failed',lease_token_digest=null,lease_expires_at=null,completed_at=clock_timestamp() where round_participant_id=${seat.id}`;
          }
          if (mode === 'terminate') child.kill('SIGKILL');
          else {
            if (mode === 'drain') child.stdin.write('abort\n');
            child.stdin.write('release\n');
          }
          await child.exited;
          await read;
          const stderr = await errors;
          if (stderr) throw Error(stderr);
          assert({
            given: `a real committed old claim paused before provider I/O, then ${mode}`,
            should:
              'show why clearing/erasure alone cannot fence a paused process, while abort-drain or verified termination prevents a new fetch',
            actual: [
              events.includes('claimed'),
              events.filter((e) => e === 'fetch').length,
            ],
            expected: [
              true,
              mode === 'clear-only' || mode === 'erase-only' ? 1 : 0,
            ],
          });
          await assertRejects({
            given: 'the predecessor token after the DB transition',
            should: 'refuse late report publication',
            actual: () =>
              f.store.completeRoundAnalysisJob(
                target,
                claim.token,
                sampleRoundAnalysisReport,
              ),
            code: 'CONFLICT',
          });
          const [row] =
            await f.sql`select attempts,input_tokens,output_tokens,report,lease_token_digest from round_analyses where round_participant_id=${seat.id}`;
          assert({
            given: 'an original possible call whose authority is gone',
            should:
              'retain the original possible exposure without invented received tokens or report',
            actual: row,
            expected: {
              attempts: 1,
              input_tokens: 0,
              output_tokens: 0,
              report: null,
              lease_token_digest: null,
            },
          });
        } finally {
          if (child.exitCode === null) child.kill('SIGKILL');
          await child.exited;
          stdout.close();
          await Promise.allSettled([read, errors, exitedEarly]);
        }
      },
      {
        roundAnalysis: {
          leaseMs: 30000,
          model: 'fixture',
          nextToken: () => randomBytes(32).toString('base64url'),
        },
      },
    );
  }, 30000);
}
