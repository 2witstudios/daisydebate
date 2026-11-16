import { broadcastPhase, createRoundRuntime } from '@daisy/debate-engine';
import { createId } from '@paralleldrive/cuid2';
import { assert } from 'riteway/bun';
import { recordingPersistence } from '../src/features/recording/persistence';
import { createRecordingCapturePort } from '../src/features/recording/capture-port';
import { createRecordingCaptureSweep } from '../src/features/recording/capture-sweep';
import { newStageCredential } from '../src/features/stage-capture/stage-access';
import { spectatorClockAt } from '../src/features/spectating/spectator-clock';
import type { withRoomRuntime } from './room-runtime.test-support';
type Runtime = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];

/** Actual recorder ownership, deliberately no media transport. Every unexpected provider operation fails the proof. */
export async function prepareUncapturedTournamentRecording(
  f: Runtime,
  roundId: string,
) {
  const database = f.store;
  const store = recordingPersistence({ database });
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
  const source = (await database.recordingCaptures.discoverUnrecorded(64)).find(
    (row) => row.roundId === roundId,
  );
  if (!source)
    throw new Error('Actual officials-recording obligation was not discovered');
  const requested = await port.request({
    ...source,
    hostOptedIn: true,
    hostHoldsRecording: false,
    now: new Date().toISOString(),
  });
  if (!requested) throw new Error('Actual admitted recording request refused');
  let captureTime = Date.now(),
    providerCalls = 0;
  const forbidden = async (): Promise<never> => {
    providerCalls += 1;
    throw new Error('No-media tournament proof must not dispatch a provider');
  };
  const events: string[] = [];
  const sweep = createRecordingCaptureSweep({
    store: database.recordingCaptures,
    port,
    egress: {
      start: forbidden,
      stop: forbidden,
      read: forbidden,
      readStageAttempt: forbidden,
      revokeObserver: forbidden,
      restoreObserver: forbidden,
    },
    holdsCapture: () => false,
    phaseAt: (round, now) =>
      broadcastPhase(
        createRoundRuntime({
          ...round,
          round,
          nextSegmentId: createId,
        }).position(now),
        round.rules.segments.length - 1,
      ),
    now: () => captureTime,
    newCredential: newStageCredential,
    stageUrl: () => {
      throw new Error('No-media proof must not mint a stage URL');
    },
    report: (event) => events.push(event),
  });
  return async () => {
    // Actual closed Round + no media room/dispatch lets the worker record absence,
    // close its own capture and settle the admission. No fabricated ACK or expiry.
    for (let pass = 0; pass < 4; pass += 1) {
      captureTime += 1000;
      await sweep();
      await sweep.settled();
    }
    const [row] =
      await f.sql`select a.settled_at,c.ended_at,c.observer_revoked_at,c.egress_dispatched_at,c.egress_id from tournament_capture_admissions a join recording_captures c on c.round_id=a.round_id where a.round_id=${roundId}`;
    if (!row) throw new Error('Actual recorder close row is missing');
    assert({
      given:
        'the actual ended Round and requested recorder with no media session or dispatched vendor work',
      should:
        'close through the normal recorder owner, reserve no phantom physical work and preserve its incomplete no-media evidence',
      actual: [
        providerCalls,
        events,
        row?.settled_at !== null,
        row?.ended_at !== null,
        row?.observer_revoked_at !== null,
        row?.egress_dispatched_at,
        row?.egress_id,
      ],
      expected: [0, [], true, true, true, null, null],
    });
  };
}
