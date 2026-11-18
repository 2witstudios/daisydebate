import { credentialHash } from '../src/features/stage-capture/stage-access';
import { requireTestServices } from '@daisy/config';
import { plannedRecording } from '@daisy/debate-engine';
import {
  isJudgeSeat,
  isModeratorSeat,
  judgeSeat,
  type RecordingPolicy,
} from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  recordingDeletionDueMs,
  roundEvidencePermissions,
  OFFICIALS_RECORDING_RETENTION_MS,
  type RecordingRound,
  type RecordingViewer,
} from '../src/features/recording/audience';
import { createRecordingCapturePort } from '../src/features/recording/capture-port';
import { createRecordingCaptureSweep } from '../src/features/recording/capture-sweep';
import { recordingPersistence } from '../src/features/recording/persistence';
import { spectatorClockAt } from '../src/features/spectating/spectator-clock';
import {
  assembleJudgedRoom,
  everyoneReady,
} from './round-judging.test-support';
import {
  launchRuntimeRound,
  withRoomRuntime,
} from './round-runtime.test-support';

setupRitewayBun();
requireTestServices(process.env);

/**
 * TAB-6.15: who a casual Room's Recording is for, as chosen before Ready and
 * frozen at Launch. `off` records nothing; `officials` keeps it for the judge
 * and moderator seats and the host until its deletion date; `released` is
 * today's Recording, for everyone seated and its audience.
 */
type Fixture = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];
type Database = Parameters<typeof recordingPersistence>[0]['database'];

/** A one-on-one Room with a human judge, its capture chosen by the host, then launched. */
async function launchedWithPolicy(
  f: Fixture,
  recordingPolicy: RecordingPolicy,
) {
  let room = await assembleJudgedRoom(f, 1);
  room = (
    await f.command(f.outsider, room, { type: 'claim-seat', seat: judgeSeat() })
  ).view;
  room = (
    await f.command(f.host, room, {
      type: 'set-capture',
      capture: { broadcast: null, recordingPolicy },
    })
  ).view;
  room = await everyoneReady(f, room, [f.host, f.guest, f.outsider]);
  return (await launchRuntimeRound(f, room)).roundId;
}

/** The production capture sweep over this Round, its Egress a fake that always runs. */
const captureSweep = (database: Database) =>
  createRecordingCaptureSweep({
    store: (database as never as { recordingCaptures: never })
      .recordingCaptures,
    port: createRecordingCapturePort({
      store: recordingPersistence({ database }),
      nextId: createId,
      inputs: {
        readFloorIntervals: database.readRecordingFloorIntervals,
        readCoverageFacts: database.readRecordingCoverageFacts,
        readBroadcastRelease: (roundId) =>
          database.readRecordingBroadcastRelease(
            roundId,
            spectatorClockAt(new Date().toISOString()),
          ),
      },
    }),
    egress: {
      readStageAttempt: async () => {
        throw new Error('Unexpected recovery in ordinary fixture');
      },
      start: async () => createId(),
      stop: async () => {},
      read: async (id) => ({ kind: 'active', id }) as never,
      revokeObserver: async () => {},
      restoreObserver: async () => {},
    },
    holdsCapture: () => true,
    phaseAt: () => 'speech' as never,
    now: () => Date.now(),
    newCredential: () => ({ secret: 's', hash: credentialHash('s') }),
    stageUrl: (id, credential) =>
      `https://app.test/stage/${id}?c=${credential}`,
    report: () => {},
  });

/** The Round as the Recording reads it, the same projection the web composes. */
const recordingRoundOf = async (
  database: Database,
  roundId: string,
): Promise<RecordingRound> => {
  const round = (await database.readRecordingRound(roundId))!;
  return {
    id: round.id,
    competitionType: round.competitionType,
    visibility: round.visibility,
    audienceLinkHash: round.audienceLinkHash,
    hostActorId: round.hostActorId,
    completedAtMs: round.completedAtMs,
    seatedActorIds: round.seats.map((seat) => seat.actorId),
    recordingPolicy: plannedRecording(round),
    officialActorIds: round.seats
      .filter((seat) => isJudgeSeat(seat.seat) || isModeratorSeat(seat.seat))
      .map((seat) => seat.actorId),
  };
};

/** Each viewer's sight of the Recording, and its deletion date, once the Round completed with a result. */
async function sightOf(f: Fixture, database: Database, roundId: string) {
  const completedAt = '2036-01-01T10:00:00.000Z';
  await f.sql`update rounds set status='completed', current_stage=null, winning_side='affirmative', completed_at=${completedAt}::timestamptz where id=${roundId}`;
  const round = await recordingRoundOf(database, roundId);
  const release = await database.readRecordingBroadcastRelease(
    roundId,
    spectatorClockAt(new Date().toISOString()),
  );
  const viewer = (actorId: string): RecordingViewer => ({
    kind: 'account',
    userId: createId(),
    actorId,
  });
  const nowMs = Date.parse(completedAt) + 60_000;
  const media = (actorId: string, at = nowMs) =>
    roundEvidencePermissions(round, release, viewer(actorId), null, at).media;
  const deletion = recordingDeletionDueMs(round);
  return {
    policy: round.recordingPolicy,
    deletesAt: deletion === null ? null : new Date(deletion).toISOString(),
    media: {
      host: media(f.host.actorId),
      judge: media(f.outsider.actorId),
      debater: media(f.guest.actorId),
      stranger: media(createId()),
      judgeAfterDeletion: media(
        f.outsider.actorId,
        Date.parse(completedAt) + OFFICIALS_RECORDING_RETENTION_MS,
      ),
    },
  };
}

/** The Recording and its capture rows, before the fixture removes the Round. */
const removeRecording = async (f: Fixture, roundId: string) => {
  await f.sql`delete from recording_processing_jobs where recording_id in (select id from recordings where round_id=${roundId})`;
  await f.sql`delete from recording_captures where round_id=${roundId}`;
  await f.sql`delete from recordings where round_id=${roundId}`;
};

const recordingsOf = async (f: Fixture, roundId: string) =>
  (
    await f.sql<
      { n: number }[]
    >`select count(*)::int as n from recordings where round_id=${roundId}`
  )[0]!.n;

test('under off, the capture sweep records nothing (TAB-6.15)', async () => {
  await withRoomRuntime(async (f) => {
    const database = f.store as never as Database;
    const roundId = await launchedWithPolicy(f, 'off');
    const sweep = captureSweep(database);
    await sweep();
    await sweep();
    assert({
      given: 'a casual Round launched with recording off',
      should: 'freeze the off policy and request no Recording on any pass',
      actual: {
        planned: plannedRecording(
          (await database.readRecordingRound(roundId))!,
        ),
        recordings: await recordingsOf(f, roundId),
      },
      expected: { planned: 'off', recordings: 0 },
    });
  });
});

test('under officials, only the officials and the host see the Recording, until its deletion date (TAB-6.15)', async () => {
  await withRoomRuntime(async (f) => {
    const database = f.store as never as Database;
    const roundId = await launchedWithPolicy(f, 'officials');
    try {
      await captureSweep(database)();
      assert({
        given:
          'a casual Round launched with its Recording kept for the officials, then completed',
        should:
          'record it, show it to the judge and the host alone, and delete it fourteen days after the Round',
        actual: {
          recordings: await recordingsOf(f, roundId),
          ...(await sightOf(f, database, roundId)),
        },
        expected: {
          recordings: 1,
          policy: 'officials',
          deletesAt: '2036-01-15T10:00:00.000Z',
          media: {
            host: true,
            judge: true,
            debater: false,
            stranger: false,
            judgeAfterDeletion: false,
          },
        },
      });
    } finally {
      await removeRecording(f, roundId);
    }
  });
});

test('under released, the Recording is everyone seated’s with no deletion date, as before (TAB-6.15)', async () => {
  await withRoomRuntime(async (f) => {
    const database = f.store as never as Database;
    const roundId = await launchedWithPolicy(f, 'released');
    try {
      await captureSweep(database)();
      assert({
        given:
          'a casual Round launched with its Recording released, then completed',
        should:
          'record it and show it to the host, the judge and the debater, kept without a deletion date',
        actual: {
          recordings: await recordingsOf(f, roundId),
          ...(await sightOf(f, database, roundId)),
        },
        expected: {
          recordings: 1,
          policy: 'released',
          deletesAt: null,
          media: {
            host: true,
            judge: true,
            debater: true,
            stranger: false,
            judgeAfterDeletion: true,
          },
        },
      });
    } finally {
      await removeRecording(f, roundId);
    }
  });
});
