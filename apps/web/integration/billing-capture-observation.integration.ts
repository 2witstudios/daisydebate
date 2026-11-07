import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { captureObservationOutput } from '../src/features/billing/capture-observation-output.test-support';
import { observeCaptureIntervals } from '../src/features/billing/capture-observation.test-support';
import { withRoomRuntime } from './room-runtime.test-support';
import { observeAc3Downloads } from './economics-download-observation.test-support';
import {
  captureHarness,
  captureWebPool,
  prepareCaptureRoom,
} from './billing-capture-observation.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('actual casual capture volume, verified output and independent transport overlap remain separate bounded TEST observations', async () => {
  const output = await captureObservationOutput(
      process.env.BILLING_CAPTURE_OUTPUT,
    ),
    root = output.directory,
    { pool, roles } = captureWebPool(databaseUrl);
  try {
    await withRoomRuntime(
      async (f) => {
        const h = captureHarness(f, root),
          roundIds = h.roundIds;
        const captureCount = async () => {
          const [row] = await f.sql`select count(*)::int as recordings,
        count(*) filter(where r.status='ready')::int as ready,
        count(*) filter(where c.egress_started_at is not null)::int as started,
        count(*) filter(where c.ended_at is not null)::int as ended,
        coalesce(sum((r.lifecycle->'media'->>'byteSize')::bigint) filter(where r.status='ready'),0)::text as bytes
        from recordings r left join recording_captures c on c.recording_id=r.id where r.round_id in(select jsonb_array_elements_text(${JSON.stringify(roundIds)}::text::jsonb))`;
          return {
            recordings: row!.recordings,
            ready: row!.ready,
            started: row!.started,
            ended: row!.ended,
            bytes: Number(row!.bytes),
          };
        };
        try {
          const firstRoom = await prepareCaptureRoom(f),
            secondCast = { host: await f.member(), guest: await f.member() };
          const secondRoom = await prepareCaptureRoom(f, secondCast),
            before = await captureCount();
          const first = await h.start(firstRoom);

          const refusal = await f
            .command(secondCast.host, secondRoom, { type: 'start-round' })
            .then(
              () => null,
              (error: { reason?: string }) => error.reason,
            );
          assert({
            given:
              'one actual running opted-in casual capture and a separately legal ready cohort',
            should:
              'refuse another fleet capture without creating a second Round or starting another Egress',
            actual: [
              refusal,
              h.intervals.length,
              (await f.operations.view(secondCast.host, secondRoom.id))
                .roundRef,
            ],
            expected: ['capture-capacity', 1, null],
          });
          await Bun.sleep(4_000); // Deliberately generate a four-second public TEST capture workload.
          const one = await h.end(first),
            midpoint = await captureCount();
          const second = await h.start(
            await f.operations.view(secondCast.host, secondRoom.id),
          );

          await Bun.sleep(4_000);
          const two = await h.end(second),
            after = await captureCount(),
            overlap = observeCaptureIntervals(h.intervals);
          const sourcePath = new URL(
            '../../../packages/db/src/casual-capture-admission.ts',
            import.meta.url,
          ).pathname;
          const source = await Bun.file(sourcePath).text();
          const declared = {
            fleet: Number(/CASUAL_CAPTURES_AT_ONCE = (\d+)/.exec(source)?.[1]),
            host: Number(/CASUAL_CAPTURES_PER_HOST = (\d+)/.exec(source)?.[1]),
          };
          assert({
            given:
              'two source-built and verified recordings through actual web lifecycle and actual recording worker role',
            should:
              'measure cumulative completed volume separately from independently observed overlap and the actual declared admission limits',
            actual: [
              before,
              [
                midpoint.recordings,
                midpoint.started,
                midpoint.ended,
                midpoint.ready,
              ],
              [
                after.recordings,
                after.started,
                after.ended,
                after.ready,
                after.bytes > 0,
              ],
              overlap,
              declared,
              [...roles],
              [one.processed.role, two.processed.role],
              [one.processed.output?.status, two.processed.output?.status],
              h.sources.every((n) => n > 0),
              h.failures,
            ],
            expected: [
              { recordings: 0, ready: 0, started: 0, ended: 0, bytes: 0 },
              [1, 1, 1, 1],
              [2, 2, 2, 2, true],
              { complete: true, completed: 2, peak: 1, active: 0 },
              { fleet: 1, host: 2 },
              ['daisy_web'],
              ['daisy_recording_worker', 'daisy_recording_worker'],
              ['built', 'built'],
              true,
              [],
            ],
          });
          const report = {
            kind: 'TEST_casual_capture_observation',
            completed: true,
            provenance:
              'Actual beta grant/Room authorization and actual capture/processing writers; locally synthesized media/transport/storage, not paid/vendor/participant media',
            before,
            midpoint,
            after,
            independentTransport: overlap,
            intervals: h.intervals,
            sourceBytes: h.sources,
            declaredAdmission: declared,
            declarationSHA256: createHash('sha256')
              .update(source)
              .digest('hex'),
            workerRoles: [one.processed.role, two.processed.role],
            builds: [one.processed.output, two.processed.output],
            limitations: [
              'Two controlled short captures, no fleet/month extrapolation',
              'No live vendor/storage/object egress',
              'Not recording_download transfer evidence',
              'Host limit2 declared, not reached because fleet limit1 applies first',
              'Broadcast lifecycle not executed',
            ],
          };
          await writeFile(
            root + '/report.json',
            JSON.stringify(report, null, 2),
            { mode: 0o600 },
          );
          // Companion-owned proof starts after actual capture snapshots are frozen.
          await observeAc3Downloads(f, {
            recordingId: one.record.id,
            videoBytes: new Uint8Array(
              await Bun.file(
                root + '/objects/recordings/' + one.record.id + '/video.mp4',
              ).arrayBuffer(),
            ),
            directory: root + '/downloads',
          });
        } catch (error) {
          await h.settled();
          await Bun.write(
            root + '/partial.json',
            JSON.stringify(
              {
                status: 'FAILED_partial_observation',
                counts: await captureCount().catch(() => null),
                intervals: h.intervals,
                sourceBytes: h.sources,
                failures: h.failures,
                limitation:
                  'Failure-time actual partial facts; no completed/verified claim beyond actual rows',
              },
              null,
              2,
            ),
          );
          throw error;
        } finally {
          await h.settled();
          for (const id of roundIds) {
            await f.sql`delete from recording_processing_jobs where recording_id in(select id from recordings where round_id=${id})`;
            await f.sql`delete from recording_captures where round_id=${id}`;
            await f.sql`delete from recordings where round_id=${id}`;
          }
        }
      },
      { client: pool },
    );
  } finally {
    await pool.close({ timeout: 0 });
    await output.close();
  }
}, 90_000);
