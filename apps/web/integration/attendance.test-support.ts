import { buildRoundTopic } from '@daisy/protocol/topics';
import { createId } from '@paralleldrive/cuid2';
import { createRoundRuntime } from '@daisy/debate-engine';
import { withRoomRuntime } from './round-runtime.test-support';
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
  participant?: { readonly userId: string; readonly actorId: string },
) =>
  withRoomRuntime(async (f) => {
    const config = foundationSelection.config;
    const host = participant ?? f.host;
    const room = await f.assemble(
      {
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
      },
      { host, guest: f.guest },
    );
    const launched = await f.command(host, room, { type: 'start-round' });
    const roundId = launched.view.roundRef!.id;
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
    const [ownedFormat] = participant
      ? await f.sql`select f.id from formats f join rooms r on r.format_id=f.id where r.id=${room.id} and f.created_by_actor_id=${participant.actorId}`
      : [];
    if (participant && !ownedFormat)
      throw new Error('Signed participant fixture format missing');
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
      if (ownedFormat) {
        await f.sql`delete from outbox where topic=${buildRoundTopic(roundId)}`;
        await f.sql`delete from rounds where id=${roundId}`;
        await f.sql`delete from rooms where id=${room.id}`;
        await f.sql`delete from formats where id=${ownedFormat.id}`;
        await f.sql`delete from format_revisions where format_id=${ownedFormat.id}`;
      }
    }
  });
