import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAttendanceFeature } from '../src/features/attendance/operations';
import {
  maintenanceAvailability,
  maintenanceTestTimers as timers,
} from './round-maintenance.test-support';
import {
  createRoundMaintenanceOperations,
  ROUND_START_HORIZON_MS,
} from '../src/features/round-finalization/maintenance';
import { startRoundMaintenance } from '../src/features/round-finalization/service';
import {
  startRuntimeRound,
  withRoomRuntime,
} from './round-runtime.test-support';
setupRitewayBun();
requireTestServices(process.env);

test(
  'actual maintenance opens a silent human-only Round at its real countdown without read side effects',
  async () =>
    withRoomRuntime(async (f) => {
      const choice = (await f.operations.catalog(f.host)).find(
        (item) => item.formatId === 'foundation',
      )!;
      const { roundId } = await startRuntimeRound(
        f,
        await f.assemble({
          selection: {
            kind: 'custom',
            definition: {
              ...choice.definition,
              configurable: {
                ...choice.definition.configurable,
                timing: {
                  ...choice.definition.configurable.timing,
                  countdownMs: { min: 0, max: 60_000 },
                },
              },
            },
            config: {
              ...choice.preset.config,
              speechTiming: {
                ...choice.preset.config.speechTiming,
                countdownMs: 10_000,
              },
            },
            competitionType: 'casual',
          },
        }),
      );
      const instanceId = createId(),
        stamps: string[] = [];
      await f.store.renewServiceInstance({ instanceId, role: 'web' });
      type Round = NonNullable<Awaited<ReturnType<typeof f.store.getRound>>>;
      let opened!: (round: Round) => void, failed!: (error: unknown) => void;
      const observed = new Promise<Round>((resolve, reject) => {
        opened = resolve;
        failed = reject;
      });
      let observing = Promise.resolve();
      const subscription = await f.store.listenOutbox({
        onListen: () => {},
        onNotify: () => {
          observing = observing
            .then(async () => {
              const round = await f.store.getRound(roundId);
              if (
                round?.segments.some(
                  (segment) =>
                    segment.type === 'speech' && segment.endedAt === null,
                )
              )
                opened(round);
            })
            .catch(failed);
        },
      });
      const availability = maintenanceAvailability({
        store: f.store,
        instanceId,
        stamps,
        failed: () => failed(new Error('Actual availability service failed')),
      }).service;
      const attendance = createAttendanceFeature({
        checkIns: f.store,
        evaluate: f.store.evaluateRoundAttendance,
        nextId: createId,
        instanceId,
      });
      const maintenance = startRoundMaintenance({
        ...createRoundMaintenanceOperations({
          startHorizonMs: ROUND_START_HORIZON_MS,
          probeRoundId: null,
          idleTimeoutMs: null,
          store: f.store,
          instanceId,
          ids: { next: createId },
          evaluate: attendance.evaluate,
        }),
        timers,
        failed,
      });
      const deadline = setTimeout(
        () =>
          failed(
            new Error('Maintenance did not open the real countdown speech'),
          ),
        15000,
      );
      try {
        const round = await observed;
        const speech = round.segments.find(
          (segment) => segment.type === 'speech' && segment.endedAt === null,
        )!;
        const [facts] =
          await f.sql`select extract(epoch from clock_timestamp()-s.started_at)*1000 as lag,(select count(*)::int from media_sessions where round_id=${roundId}) as sessions,(select count(*)::int from round_transcript_freezes where round_id=${roundId}) as freezes from round_segments s where s.id=${speech.id}`;
        assert({
          given:
            'an actual launched human-only Room with no media session or browser command/tick after start',
          should:
            'open through the real engine at the stored10s deadline within500ms and keep unfinished input unfrozen',
          actual: {
            status: round.status,
            delay: Date.parse(speech.startedAt) - Date.parse(round.startedAt!),
            countdown: round.rules.countdownMs,
            discovered: Number(facts.lag) <= 500,
            sessions: facts.sessions,
            freezes: facts.freezes,
          },
          expected: {
            status: 'active',
            delay: 10000,
            countdown: 10000,
            discovered: true,
            sessions: 0,
            freezes: 0,
          },
        });
      } finally {
        clearTimeout(deadline);
        await maintenance.stop();
        await availability.stop();
        await observing;
        await subscription.unlisten();
        for (const stamp of stamps)
          await f.sql`delete from availability_samples where at=${stamp}::timestamptz`;
        await f.sql`delete from service_instances where instance_id=${instanceId}`;
      }
    }),
  20000,
);
