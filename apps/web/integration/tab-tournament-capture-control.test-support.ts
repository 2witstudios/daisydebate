import { addMs, instantMs } from '@daisy/clock';
import type { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { assert } from 'riteway/bun';
import { mediaPhase, type StageEgressFact } from '@daisy/debate-engine';
import { admitsPrincipalAccess } from '@daisy/auth/authorization';
import { roundTickProjection } from '../src/features/round-finalization/operations';
import { createRecordingCapturePort } from '../src/features/recording/capture-port';
import { createRecordingCaptureSweep } from '../src/features/recording/capture-sweep';
import { recordingPersistence } from '../src/features/recording/persistence';
import { newStageCredential } from '../src/features/stage-capture/stage-access';
import { createStageRoute } from '../src/features/stage-capture/stage-route';
import { spectatorClockAt } from '../src/features/spectating/spectator-clock';
import type { withRoomRuntime } from './room-runtime.test-support';

type Runtime = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];

/** Actual DB/worker composition with a controlled vendor transport, not a native capture proof. */
export const proveTournamentCaptureControl = async (input: {
  readonly f: Runtime;
  readonly owner: SQL;
  readonly roundId: string;
  readonly hostingVersionId: string;
}) => {
  const { f, owner, roundId, hostingVersionId } = input;
  const database = f.store as never as Parameters<
    typeof recordingPersistence
  >[0]['database'];
  const store = recordingPersistence({ database });
  const captures = database.recordingCaptures;
  const [seated] =
    await owner`select p.actor_id from round_participants p join actors a on a.id=p.actor_id where p.round_id=${roundId} and a.kind='human' order by p.id limit 1`;
  if (!seated) throw new Error('Actual Round has no seated human');
  await database.mediaSessions.ensureBinding({
    roundId,
    caller: { actorId: String(seated.actor_id), admits: admitsPrincipalAccess },
    buildProjection: roundTickProjection(createId),
    mediaPhase,
  });
  const port = createRecordingCapturePort({
    store,
    nextId: createId,
    inputs: {
      readFloorIntervals: database.readRecordingFloorIntervals,
      readCoverageFacts: database.readRecordingCoverageFacts,
      readBroadcastRelease: (id) =>
        database.readRecordingBroadcastRelease(
          id,
          spectatorClockAt(new Date().toISOString()),
        ),
    },
  });
  const credential = newStageCredential();
  let starts = 0,
    stops = 0,
    revokes = 0,
    durableBeforeIo = false,
    recoverable = false;
  let vendor: StageEgressFact = { kind: 'active', id: 'EG_CONTROLLED' };
  const reports: string[] = [];
  const sweep = createRecordingCaptureSweep({
    store: captures,
    port,
    egress: {
      start: async () => {
        starts += 1;
        const [row] =
          await owner`select c.egress_generation,c.egress_dispatched_at,c.egress_id,c.stage_credential_hash from recording_captures c join recordings r on r.id=c.recording_id where r.round_id=${roundId}`;
        durableBeforeIo =
          row?.egress_generation === 1 &&
          row.egress_dispatched_at !== null &&
          row.egress_id === null &&
          row.stage_credential_hash === credential.hash;
        // The provider accepted the request but its response was lost.
        throw new Error('Controlled response loss after vendor acceptance');
      },
      readStageAttempt: async () =>
        recoverable
          ? { kind: 'observed', egressId: 'EG_CONTROLLED', fact: vendor }
          : { kind: 'unresolved' },
      read: async () => vendor,
      stop: async () => {
        stops += 1;
      }, // No terminal confirmation: work may still be live.
      revokeObserver: async () => {
        revokes += 1;
      },
      restoreObserver: async () => {
        throw new Error('Closed capture must never restore');
      },
    },
    holdsCapture: () => false,
    // The phase input is controlled here; native privacy timing is a separate proof.
    phaseAt: () => ({ kind: 'public' }),
    now: Date.now,
    newCredential: () => credential,
    stageUrl: (id, secret) =>
      `https://controlled.invalid/stage/${id}?c=${secret}`,
    report: (event) => {
      reports.push(event);
    },
  });
  const pass = async () => {
    await Bun.sleep(825);
    await sweep();
    await sweep.settled();
  };
  const physical = async () => {
    const [row] =
      await owner`select c.egress_generation,c.egress_dispatched_at,c.egress_id,c.egress_settled_at,c.observer_revoked_at,c.ended_at,a.settled_at,a.deadline_at,r.status from recording_captures c join tournament_capture_admissions a on a.round_id=c.round_id join rounds r on r.id=c.round_id where c.round_id=${roundId}`;
    if (!row) throw new Error('Capture control row missing');
    return row;
  };
  const reserved = async () =>
    Number(
      (
        await owner`select running from daisy_nonranked_capture_capacity(${createId()},null,null,null)`
      )[0]!.running,
    );
  await pass();
  const recording = await store.findByRound(roundId);
  if (!recording) throw new Error('Admitted capture was not discovered');
  if (recording.eligibility.kind !== 'tournament_admission')
    throw new Error('Missing actual admitted source');
  const pinned = recording.eligibility;
  const wrong = {
    ...pinned,
    deadlineAt: addMs(pinned.deadlineAt, 1),
  };
  const forged = await owner
    .begin(async (tx) => {
      await tx`insert into recordings(id,round_id,recording_class,eligibility,status,lifecycle)
      values(${createId()},${roundId},'casual',${JSON.stringify(wrong)}::text::jsonb,'requested','{"status":"requested"}'::jsonb)`;
    })
    .then(
      () => 'accepted',
      (error: { constraint?: string }) => error.constraint ?? 'other-error',
    );
  assert({
    given:
      'a real admitted Recording and another insert naming that admission with a one-millisecond extension',
    should:
      'refuse at the owning database source boundary and expose only the original deadline to processing',
    actual: [
      forged,
      (await captures.readPublicHistory(recording.id)).captureUntilMs,
    ],
    expected: ['recordings_admission_deadline', instantMs(pinned.deadlineAt)],
  });

  await pass();
  const unknown = await physical();
  assert({
    given:
      'an actual admitted event Round and a vendor-accepted Start whose answer is lost',
    should:
      'durably reserve one generation before I/O and retain unknown work without a second Start',
    actual: [
      durableBeforeIo,
      starts,
      unknown.egress_id,
      unknown.egress_dispatched_at !== null,
      unknown.egress_settled_at,
      await reserved(),
      recording.eligibility.kind,
      reports,
    ],
    expected: [
      true,
      1,
      null,
      true,
      null,
      1,
      'tournament_admission',
      ['recording.egress.start_failed'],
    ],
  });
  recoverable = true;
  await pass();
  await pass();
  await owner`update account_entitlement_grants set revoked_at=clock_timestamp() where hosting_version_id=${hostingVersionId}`;
  const recovered = await physical();
  assert({
    given:
      'exact recovery of the accepted attempt followed by independent funding revocation',
    should:
      'acknowledge the same generation once and preserve only the original finite obligation',
    actual: [
      starts,
      recovered.egress_id,
      recovered.egress_generation,
      recovered.settled_at,
      recovered.deadline_at.getTime() === unknown.deadline_at.getTime(),
      (await store.findByRound(roundId))?.lifecycle.status,
      await reserved(),
    ],
    expected: [1, 'EG_CONTROLLED', 1, null, true, 'capturing', 1],
  });
  await owner`select pg_sleep(greatest(0,extract(epoch from (deadline_at-clock_timestamp())))+0.02) from tournament_capture_admissions where round_id=${roundId}`;
  let tokens = 0;
  const stage = createStageRoute({
    store: captures,
    observerToken: async () => {
      tokens += 1;
      return 'forbidden';
    },
    livekitUrlFor: () => 'wss://controlled.invalid',
    now: Date.now,
    nextId: createId,
  });
  const valid = await stage(
    new Request('https://controlled.invalid', {
      headers: { 'x-stage-credential': credential.secret },
    }),
    recording.id,
  );
  const stranger = await stage(
    new Request('https://controlled.invalid'),
    recording.id,
  );
  await pass();
  const expired = await physical();
  assert({
    given:
      'the real DB deadline while the Round remains active and the provider stop has no terminal acknowledgement',
    should:
      'deny stage tokens, revoke subscription, request stop and hold physical capacity beyond expiry',
    actual: [
      valid.status,
      stranger.status,
      tokens,
      expired.status,
      starts,
      stops > 0,
      revokes > 0,
      expired.observer_revoked_at !== null,
      expired.egress_settled_at,
      expired.settled_at,
      await captures.settleUndispatchedTournamentAdmission(roundId),
      await reserved(),
    ],
    expected: [
      410,
      404,
      0,
      'active',
      1,
      true,
      true,
      true,
      null,
      null,
      false,
      1,
    ],
  });
  vendor = { kind: 'complete' };
  await pass();
  const terminal = await physical();
  assert({
    given:
      'a confirmed terminal vendor observation before logical capture close',
    should:
      'persist physical settlement and keep the admission until capture close',
    actual: [
      terminal.egress_settled_at !== null,
      terminal.settled_at,
      await reserved(),
    ],
    expected: [true, null, 1],
  });
  await pass();
  const closed = await physical();
  const replay = await captures.beginOwnEgressAttempt({
    recordingId: recording.id,
    generation: 2,
    stageCredentialHash: credential.hash,
  });
  assert({
    given:
      'confirmed physical settlement plus observer withdrawal and capture completion',
    should:
      'release exactly once and refuse replay/restart without changing the Round or finite deadline',
    actual: [
      closed.ended_at !== null,
      closed.settled_at !== null,
      await reserved(),
      replay,
      starts,
      closed.status,
      closed.deadline_at.getTime() === unknown.deadline_at.getTime(),
      reports.filter((event) => event === 'recording.capture_failed'),
    ],
    expected: [true, true, 0, false, 1, 'active', true, []],
  });
};
