import {
  mkdtemp,
  writeFile,
  readFile,
  readdir,
  stat,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { billingEconomicsReadSchema } from '@daisy/protocol/billing-economics';
import { composeBillingEconomics } from '../src/server/billing-economics';
import {
  withAc3Runtime,
  untilCommitted,
} from './economics-ac3-runtime.test-support';
import {
  prepareAc3Round,
  requestAc3Analysis,
  readAc3Analysis,
  refuseAc3AfterPeerErasure,
} from './economics-ac3-cohort.test-support';

setupRitewayBun();

test('actual composed AI workers observe increasing beta workload separately from dispatch high-water and persist equal private economics', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'billing-ac3-observation-'));
  try {
    await withAc3Runtime(
      directory,
      async ({
        app,
        fixture: f,
        observer,
        judgeTimers,
        analysisTimers,
        failures,
        instanceId,
        limits,
        role,
      }) => {
        const bracketStart = await f.store.databaseNow();
        const current = new Date(bracketStart);
        const window = {
          startsAt: new Date(
            Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1),
          ).toISOString(),
          endsAt: new Date(
            Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1),
          ).toISOString(),
        };
        const reader = f.store.billingEconomics(instanceId);
        const snapshot = async () =>
          billingEconomicsReadSchema.parse(await reader.read(window));
        const baseline = await snapshot();
        assert({
          given:
            'a fresh canonical cohort before any AI workload, through real current daisy_web operations',
          should:
            'observe the actual empty baseline rather than assume or invent volume',
          actual: [role, baseline.complete, baseline.attempts, baseline.usage],
          expected: ['daisy_web', true, [], []],
        });
        const targets: Awaited<ReturnType<typeof prepareAc3Round>>[] = [];
        const progression: unknown[] = [];
        for (let index = 0; index < 2; index++) {
          const target = await prepareAc3Round(f, index > 0);
          targets.push(target);
          await untilCommitted(
            judgeTimers.pulse,
            async () => {
              const [job] =
                await f.sql`select status,result_ballot_id from round_judging_jobs where round_id=${target.roundId}`;
              return (
                job?.status === 'succeeded' && job.result_ballot_id !== null
              );
            },
            failures,
          );
          const measured = await snapshot();
          const calls = measured.attempts
            .filter((row) => row.feature === 'casual_ai_judge')
            .reduce((n, row) => n + row.runs, 0);
          const complete = measured.usage
            .filter(
              (row) =>
                row.feature === 'casual_ai_judge' && row.state === 'delivered',
            )
            .reduce((n, row) => n + row.reservations, 0);
          progression.push({
            feature: 'casual_ai_judge',
            calls,
            complete,
            observed: observer.facts('casual_ai_judge'),
          });
        }
        for (const target of targets) {
          await requestAc3Analysis(f, target);
          await untilCommitted(
            analysisTimers.pulse,
            async () => {
              const result = await readAc3Analysis(f, target);
              return result.facts.analysis?.kind === 'succeeded';
            },
            failures,
          );
          const measured = await snapshot();
          const calls = measured.attempts
            .filter((row) => row.feature === 'round_analysis')
            .reduce((n, row) => n + row.runs, 0);
          const complete = measured.usage
            .filter(
              (row) =>
                row.feature === 'round_analysis' && row.state === 'delivered',
            )
            .reduce((n, row) => n + row.reservations, 0);
          progression.push({
            feature: 'round_analysis',
            calls,
            complete,
            observed: observer.facts('round_analysis'),
          });
        }
        const beforeReread = observer.facts('round_analysis');
        for (const target of targets) await readAc3Analysis(f, target);
        await analysisTimers.pulse();
        assert({
          given:
            'two real sequential committed ballots and two explicit requested reports through actual SDK/role/worker composition',
          should:
            'observe volume1→2 while independent in-flight provider high-water stays1; stored-report rereads never create another call',
          actual: [
            progression,
            observer.facts('round_analysis'),
            failures.length,
          ],
          expected: [
            (['casual_ai_judge', 'round_analysis'] as const).flatMap(
              (feature) =>
                [1, 2].map((calls) => ({
                  feature,
                  calls,
                  complete: calls,
                  observed: {
                    calls,
                    known: calls,
                    unknown: 0,
                    peak: 1,
                    active: 0,
                  },
                })),
            ),
            beforeReread,
            0,
          ],
        });
        const end = await snapshot();
        const capacity = [
          {
            plan: 'beta',
            feature: 'casual_ai_judge',
            completed: null,
            possibleCalls: null,
            capacity: {
              kind: 'measured',
              peak: observer.facts('casual_ai_judge').peak,
              limit: limits.judging,
            },
          },
          {
            plan: 'beta',
            feature: 'round_analysis',
            completed: null,
            possibleCalls: null,
            capacity: {
              kind: 'measured',
              peak: observer.facts('round_analysis').peak,
              limit: limits.analysis,
            },
          },
        ];
        await writeFile(
          join(directory, `feed-${window.startsAt.slice(0, 7)}.json`),
          JSON.stringify({
            ...window,
            floorBasisPoints: 3000,
            modelCostBasis: 'usage_counters',
            revenue: [],
            costs: [],
            rates: [],
            coverage: [],
            revenueCoverage: [],
            volume: capacity,
          }),
          { mode: 0o600 },
        );
        const collected = await composeBillingEconomics(app, instanceId).run(
          window,
        );
        if (collected.kind !== 'reported' || collected.report.kind !== 'report')
          throw Error('Actual private collector did not report');
        const report = collected.report;
        const files = (await readdir(directory)).filter((name) =>
          name.startsWith('report-'),
        );
        if (files.length !== 1)
          throw Error('Expected one actual private report');
        const file = join(directory, files[0]!);
        const saved = JSON.parse(await readFile(file, 'utf8')) as {
          snapshot: typeof end;
          report: typeof report;
        };
        const ai = report.volume.filter(
          (row) =>
            row.plan === 'beta' &&
            (row.feature === 'casual_ai_judge' ||
              row.feature === 'round_analysis'),
        );
        const unobserved = report.volume.filter(
          (row) =>
            row.feature === 'casual_capture' ||
            row.feature === 'recording_download',
        );
        assert({
          given:
            'the same actual cohort/window in SQL, observed intervals and composed private collector/file sink, with no financial exports',
          should:
            'retain observed AI counts/capacity and original beta attribution; keep financial money and unobserved capture/download unknown, never a monthly Room/spend ceiling',
          actual: {
            ai,
            attemptSources: [
              ...new Set(end.attempts.map((row) => row.sourceKind)),
            ],
            usageSources: [...new Set(end.usage.map((row) => row.sourceKind))],
            snapshotEquality:
              JSON.stringify(saved.snapshot.attempts) ===
                JSON.stringify(end.attempts) &&
              JSON.stringify(saved.snapshot.usage) ===
                JSON.stringify(end.usage),
            reportEquality:
              JSON.stringify(saved.report) === JSON.stringify(report),
            privateMode: (await stat(file)).mode & 0o777,
            unobserved: unobserved.every(
              (row) =>
                row.completed === null &&
                row.possibleCalls === null &&
                row.capacity.kind === 'unknown',
            ),
            money: report.plans.beta.margin.kind,
            limits,
          },
          expected: {
            ai: capacity.map((row) => ({
              ...row,
              completed: 2,
              possibleCalls: 2,
            })),
            attemptSources: ['beta'],
            usageSources: ['beta'],
            snapshotEquality: true,
            reportEquality: true,
            privateMode: 0o600,
            unobserved: true,
            money: 'unknown',
            limits: { judging: 3, analysis: 2 },
          },
        });
        await refuseAc3AfterPeerErasure(f, targets[0]!);
        process.stdout.write(
          JSON.stringify({
            kind: 'BILLING_AC3_CONTROLLED_TEST_OBSERVATION',
            scope:
              'beta TEST cohort, controlled SDK response, no paid/supplier/media/production measurement',
            window,
            bracket: {
              startsAt: bracketStart,
              endsAt: await f.store.databaseNow(),
            },
            baseline,
            end,
            progression,
            events: observer.events,
            capacity,
            report,
            privateReportSha256: new Bun.CryptoHasher('sha256')
              .update(await readFile(file))
              .digest('hex'),
            limits,
            units:
              'simultaneous complete() provider requests in this single TEST web process',
          }) + '\n',
        );
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 45000);
