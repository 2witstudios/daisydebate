import { hostWaits } from '@daisy/worker/host';
import { finishedOrBlockedBehind } from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import { isAppError } from '@daisy/errors';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withTerminalCapture } from './tab-terminal-capture.test-support';
setupRitewayBun();

test(
  'terminal zero-work tournament admission releases once at actual DB time and existing unknown work never does',
  () =>
    withTerminalCapture(async ({ f, owner, world, rooms, start, end }) => {
      const director = world.bots.Director!,
        lobbyId = world.made.get('tournament-lobby')!;
      const first = await start(rooms[0]!.room_id);
      assert({
        given:
          'a genuinely running officials-recording Round before its actual DB admission deadline',
        should: 'refuse zero-work settlement while it can still capture',
        actual:
          await f.store.recordingCaptures.settleUndispatchedTournamentAdmission(
            first,
          ),
        expected: false,
      });
      await end(first);
      const [before] =
        await owner`select clock_timestamp()<deadline_at early from tournament_capture_admissions where round_id=${first}`;
      const fault = new Error(
        'Controlled failure after actual zero-work settlement',
      );
      let rolledBack = false;
      try {
        await owner.begin(async (tx) => {
          const [answer] =
            await tx`select public.daisy_recording_settle_undispatched_tournament_admission(${first}) settled`;
          if (answer!.settled !== true)
            throw new Error('Actual rollback settlement refused');
          throw fault;
        });
      } catch (error) {
        if (error !== fault) throw error;
        rolledBack = true;
      }
      assert({
        given: 'a failure after the actual SQL settlement update',
        should:
          'roll its physical fact back so the same source can settle normally',
        actual: [
          rolledBack,
          (
            await owner`select settled_at from tournament_capture_admissions where round_id=${first}`
          )[0]!.settled_at,
        ],
        expected: [true, null],
      });
      const settled =
        await f.store.recordingCaptures.settleUndispatchedTournamentAdmission(
          first,
        );
      assert({
        given:
          'its genuine irreversible terminal Round with no Recording/capture/dispatch and future physical deadline',
        should:
          'settle immediately at actual DB time without a physical clock override',
        actual: [before!.early, settled],
        expected: [true, true],
      });
      const [stamp] = await owner<
        { settled_at: Date }[]
      >`select settled_at from tournament_capture_admissions where round_id=${first}`;
      const repeated =
        await f.store.recordingCaptures.settleUndispatchedTournamentAdmission(
          first,
        );
      assert({
        given: 'repeated settlement of that exact actual source',
        should:
          'acknowledge it without extending or replacing the original physical settlement instant',
        actual: [
          repeated,
          (
            await owner<
              { settled_at: Date }[]
            >`select settled_at from tournament_capture_admissions where round_id=${first}`
          )[0]!.settled_at.toISOString(),
        ],
        expected: [true, stamp!.settled_at.toISOString()],
      });
      const [sourcePin] = await owner<
        { id: string; deadline_at: Date }[]
      >`select id,deadline_at from tournament_capture_admissions where round_id=${first}`;
      let denied = false;
      try {
        await f.store.requestRecording({
          id: createId(),
          roundId: first,
          class: 'casual',
          eligibility: {
            kind: 'tournament_admission',
            admissionId: sourcePin!.id,
            deadlineAt: sourcePin!.deadline_at.toISOString(),
          },
        });
      } catch (error) {
        if (!isAppError(error)) throw error;
        denied = error.code === 'AUTHORIZATION';
      }
      const refusedInsert = async (eligibility: object) =>
        owner
          .begin(async (tx) => {
            await tx`insert into recordings(id,round_id,recording_class,eligibility,status,lifecycle) values(${createId()},${first},'casual',${JSON.stringify(eligibility)}::jsonb,'requested','{"status":"requested"}'::jsonb)`;
          })
          .then(
            () => null,
            (error: { constraint?: string }) => error.constraint ?? 'other',
          );
      const reopened = await owner
        .begin(async (tx) => {
          await tx`update rounds set status='active',current_stage='awaiting_ballot',completed_at=null,winning_side=null,ranking=null where id=${first}`;
        })
        .then(
          () => null,
          (error: { constraint?: string }) => error.constraint ?? 'other',
        );
      assert({
        given:
          'a settled real source addressed through the actual Recording store, direct exact/alternate source INSERTs and a terminal Round reopen',
        should:
          'refuse every future use while preserving immutable ending and physical settlement',
        actual: [
          denied,
          await refusedInsert({
            kind: 'tournament_admission',
            admissionId: sourcePin!.id,
            deadlineAt: sourcePin!.deadline_at.toISOString(),
          }),
          await refusedInsert({
            kind: 'host_opt_in',
            hostActorId: director.actorId,
          }),
          reopened,
        ],
        expected: [
          true,
          'recordings_admission_deadline',
          'recordings_admission_deadline',
          'rounds_terminal_status',
        ],
      });
      const second = await start(rooms[1]!.room_id);
      assert({
        given:
          'a different real Ready Room after the terminal zero-work release',
        should: 'acquire the released fleet-one slot through ordinary Start',
        actual: (
          await owner`select count(*)::int n from tournament_capture_admissions where settled_at is null and lobby_id=${lobbyId}`
        )[0]!.n,
        expected: 1,
      });
      const source = (
        await f.store.recordingCaptures.discoverUnrecorded(64)
      ).find((row) => row.roundId === second)?.tournamentAdmission;
      if (!source) throw new Error('Second actual admitted source missing');
      const recording = await f.store.requestRecording({
        id: createId(),
        roundId: second,
        class: 'casual',
        eligibility: {
          kind: 'tournament_admission',
          admissionId: source.admissionId,
          deadlineAt: source.deadlineAt,
        },
      });
      await f.store.recordingCaptures.openOwn({
        recordingId: recording.id,
        roundId: second,
      });
      const dispatched = await f.store.recordingCaptures.beginOwnEgressAttempt({
        recordingId: recording.id,
        generation: 1,
        stageCredentialHash: 'a'.repeat(64),
      });
      if (!dispatched) throw new Error('Actual durable dispatch fence refused');
      await end(second);
      assert({
        given:
          'an actual Recording with a committed pre-I/O dispatch fence and no terminal vendor observation',
        should:
          'retain the physical reservation after logical Round completion and refuse ordinary close without the required ACKs',
        actual: [
          await f.store.recordingCaptures.settleUndispatchedTournamentAdmission(
            second,
          ),
          await f.store.recordingCaptures.closeOwn({
            recordingId: recording.id,
            now: new Date(),
          }),
          (
            await owner`select settled_at from tournament_capture_admissions where round_id=${second}`
          )[0]!.settled_at,
        ],
        expected: [false, false, null],
      });
    }),
  90000,
);

test(
  'a terminal actual Recording with no dispatch stays with its recorder close owner',
  () =>
    withTerminalCapture(async ({ f, owner, rooms, start, end }) => {
      const roundId = await start(rooms[0]!.room_id);
      const source = (
        await f.store.recordingCaptures.discoverUnrecorded(64)
      ).find((row) => row.roundId === roundId)?.tournamentAdmission;
      if (!source) throw new Error('Actual admitted source missing');
      const recording = await f.store.requestRecording({
        id: createId(),
        roundId,
        class: 'casual',
        eligibility: {
          kind: 'tournament_admission',
          admissionId: source.admissionId,
          deadlineAt: source.deadlineAt,
        },
      });
      await end(roundId);
      assert({
        given:
          'a real terminal Round whose actual recorder was opened but no provider attempt exists',
        should:
          'refuse early zero-work settlement because the recorder must own its close',
        actual: [
          await f.store.recordingCaptures.settleUndispatchedTournamentAdmission(
            roundId,
          ),
          (
            await owner`select count(*)::int n from recordings where round_id=${roundId}`
          )[0]!.n,
          (
            await owner`select settled_at from tournament_capture_admissions where round_id=${roundId}`
          )[0]!.settled_at,
        ],
        expected: [false, 1, null],
      });
      await f.store.recordingCaptures.openOwn({
        recordingId: recording.id,
        roundId,
      });
      assert({
        given:
          'an attempt to dispatch that actual retained recorder after the Round ended',
        should:
          'refuse a new generation rather than using its unsettled admission to restart',
        actual: await f.store.recordingCaptures.beginOwnEgressAttempt({
          recordingId: recording.id,
          generation: 1,
          stageCredentialHash: 'b'.repeat(64),
        }),
        expected: false,
      });
    }),
  90000,
);

for (const work of ['open', 'dispatch'] as const)
  for (const first of ['work', 'settlement'] as const) {
    test(
      `actual ${work}/${first} admission lock order cannot cross terminal zero-work settlement`,
      () =>
        withTerminalCapture(async ({ f, owner, rooms, start, end }) => {
          const roundId = await start(rooms[0]!.room_id);
          const pin = (
            await f.store.recordingCaptures.discoverUnrecorded(64)
          ).find((row) => row.roundId === roundId)?.tournamentAdmission;
          if (!pin) throw new Error('Actual race source missing');
          const request = () =>
            f.store.requestRecording({
              id: createId(),
              roundId,
              class: 'casual',
              eligibility: {
                kind: 'tournament_admission',
                admissionId: pin.admissionId,
                deadlineAt: pin.deadlineAt,
              },
            });
          const recording = work === 'dispatch' ? await request() : null;
          if (recording)
            await f.store.recordingCaptures.openOwn({
              recordingId: recording.id,
              roundId,
            });
          await end(roundId);
          let workAnswer: string | null = null,
            settled: boolean | null = null;
          const perform = async () => {
            try {
              if (work === 'open') {
                await request();
                workAnswer = 'opened';
              } else {
                workAnswer =
                  (await f.store.recordingCaptures.beginOwnEgressAttempt({
                    recordingId: recording!.id,
                    generation: 1,
                    stageCredentialHash: 'c'.repeat(64),
                  }))
                    ? 'dispatched'
                    : 'refused';
              }
            } catch (error) {
              if (!isAppError(error)) throw error;
              workAnswer = error.code;
            }
          };
          const settle = async () => {
            settled =
              await f.store.recordingCaptures.settleUndispatchedTournamentAdmission(
                roundId,
              );
          };
          const queued = await owner.begin(async (tx) => {
            await tx`select id from tournament_capture_admissions where round_id=${roundId} for update`;
            const [holder] = await tx`select pg_backend_pid() pid`;
            const a = first === 'work' ? perform() : settle();
            if (
              (await finishedOrBlockedBehind(a, f.sql, Number(holder!.pid), {
                waits: hostWaits,
              })) !== 'blocked'
            )
              throw new Error('First actual admission writer did not wait');
            const waiters = await f.sql<
              { pid: number }[]
            >`select pid from pg_stat_activity where ${Number(holder!.pid)}=any(pg_blocking_pids(pid))`;
            if (waiters.length !== 1)
              throw new Error('First admission backend is ambiguous');
            const b = first === 'work' ? settle() : perform();
            if (
              (await finishedOrBlockedBehind(b, f.sql, waiters[0]!.pid, {
                waits: hostWaits,
              })) !== 'blocked'
            )
              throw new Error(
                'Second actual admission writer did not queue behind first',
              );
            return { a, b };
          });
          await queued.a;
          await queued.b;
          const [rows] =
            await owner`select (select count(*)::int from recordings where round_id=${roundId}) n,(select settled_at is not null from tournament_capture_admissions where round_id=${roundId}) settled,(select count(*)::int from recording_captures where round_id=${roundId} and egress_dispatched_at is not null) dispatches`;
          const expected =
            work === 'dispatch'
              ? ['refused', false, 1, false, 0]
              : first === 'work'
                ? ['opened', false, 1, false, 0]
                : ['AUTHORIZATION', true, 0, true, 0];
          assert({
            given: `genuine terminal Round and pinned ${work} then ${first} first under the actual admission fence`,
            should:
              'serialize the real owners, refuse new terminal dispatch and never release an existing or uncertain resource',
            actual: [
              workAnswer,
              settled,
              rows!.n,
              rows!.settled,
              rows!.dispatches,
            ],
            expected,
          });
        }),
      90000,
    );
  }
