import { createId } from '@paralleldrive/cuid2';
import { createRoundRuntime } from '@daisy/debate-engine';
import {
  withRoomRuntime,
  startRuntimeRound,
} from './round-runtime.test-support';
import { foundationSelection } from './foundation-selection.test-support';
import { createAttendanceFeature } from '../src/features/attendance/operations';

/** Real Room launch/commands/shared clock; no invented actual speech timeline. */
export const withAttendanceRound = (
  run: (input: {
    readonly f: Parameters<Parameters<typeof withRoomRuntime>[0]>[0];
    readonly attendance: ReturnType<typeof createAttendanceFeature>;
    readonly roundId: string;
    readonly segmentId: string;
  }) => Promise<void>,
) =>
  withRoomRuntime(async (f) => {
    const config = foundationSelection.config;
    const room = await f.assemble({
      selection: {
        ...foundationSelection,
        config: {
          ...config,
          preRoundPrep: { enabled: false },
          resolutionDraw: { enabled: false },
          inRoundPrep: { enabled: false },
          speechTiming: { ...config.speechTiming, countdownMs: 0 },
        },
      },
    });
    const { roundId } = await startRuntimeRound(f, room);
    await f.store.executeRoundTick({
      roundId,
      buildProjection: ({ round, now }) =>
        createRoundRuntime({
          round,
          rules: round.rules,
          participants: round.participants,
          checkpoint: round.checkpoint,
          segments: round.segments,
          nextSegmentId: createId,
        }).tick(now),
    });
    const round = await f.store.getRound(roundId);
    const segment = round?.segments.find(
      (s) => s.type === 'speech' && s.endedAt === null,
    );
    if (!segment)
      throw new Error('Actual shared clock did not open the first speech');
    const instanceId = createId();
    await f.store.renewServiceInstance({ instanceId, role: 'web' });
    const attendance = createAttendanceFeature({
      checkIns: f.store,
      evaluate: f.store.evaluateRoundAttendance,
      nextId: createId,
      instanceId,
    });
    try {
      await run({ f, attendance, roundId, segmentId: segment.id });
    } finally {
      await f.sql`delete from service_instances where instance_id=${instanceId}`;
    }
  });
