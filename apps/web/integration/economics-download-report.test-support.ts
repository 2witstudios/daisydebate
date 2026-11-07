import { writeFile, readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createId } from '@paralleldrive/cuid2';
import { assert } from 'riteway/bun';
import type { App } from '../src/server/app';
import { composeBillingEconomics } from '../src/server/billing-economics';
import type { withRoomRuntime } from './room-runtime.test-support';
import type { withDownloadTransport } from './economics-download-transport.test-support';

export async function collectDownloadObservation(input: {
  readonly app: App;
  readonly f: Parameters<Parameters<typeof withRoomRuntime>[0]>[0];
  readonly transport: Parameters<
    Parameters<typeof withDownloadTransport>[0]
  >[0];
  readonly directory: string;
  readonly bracketStart: string;
}) {
  const { app, f, transport, directory } = input;
  const current = new Date(input.bracketStart);
  const window = {
    startsAt: new Date(
      Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1),
    ).toISOString(),
    endsAt: new Date(
      Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1),
    ).toISOString(),
  };
  const volume = {
    plan: 'beta',
    feature: 'recording_download',
    completed: transport.facts().completed,
    possibleCalls: null,
    capacity: { kind: 'unknown' },
  };
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
      volume: [volume],
    }),
    { mode: 0o600 },
  );
  const instanceId = createId();
  await f.store.renewServiceInstance({ instanceId, role: 'web' });
  try {
    const collected = await composeBillingEconomics(app, instanceId).run(
      window,
    );
    if (collected.kind !== 'reported' || collected.report.kind !== 'report')
      throw Error('Actual private download collector did not report');
    const files = (await readdir(directory)).filter((name) =>
      name.startsWith('report-'),
    );
    if (files.length !== 1) throw Error('Expected one actual private report');
    const file = join(directory, files[0]!);
    const bytes = await readFile(file);
    const saved = JSON.parse(bytes.toString()) as {
      report: typeof collected.report;
    };
    assert({
      given:
        'actual verified download receipts bound to this TEST window and composed private collector',
      should:
        'persist measured volume with unknown configured transfer capacity and financial margin, never reinterpret signing rate or one Room as a spend bound',
      actual: {
        volume: collected.report.volume.filter(
          (row) => row.plan === 'beta' && row.feature === 'recording_download',
        ),
        reportEquality:
          JSON.stringify(saved.report) === JSON.stringify(collected.report),
        privateMode: (await stat(file)).mode & 0o777,
        money: collected.report.plans.beta.margin.kind,
      },
      expected: {
        volume: [volume],
        reportEquality: true,
        privateMode: 0o600,
        money: 'unknown',
      },
    });
    return {
      window,
      bracket: {
        startsAt: input.bracketStart,
        endsAt: await f.store.databaseNow(),
      },
      volume,
      privateReportSha256: new Bun.CryptoHasher('sha256')
        .update(bytes)
        .digest('hex'),
    };
  } finally {
    await f.sql`delete from service_instances where instance_id=${instanceId}`;
  }
}
