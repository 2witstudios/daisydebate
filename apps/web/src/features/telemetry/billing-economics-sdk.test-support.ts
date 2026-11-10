import * as Sentry from '@sentry/nextjs';
import { mkdtemp, writeFile, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initSentry } from './sentry-init';
import { createSentryErrorReporter } from './sentry-reporter';
import { createBillingEconomicsCollector } from '../billing/economics-collector';
import { raiseEconomicsSignals } from '../billing/economics-alert';
import { dataset, now, month } from '../billing/economics.test-support';
import {
  estimateQualification,
  estimateAssumptions,
} from '../billing/economics-qualification.test-support';
import { createBillingEconomicsFiles } from '../../server/billing-economics-files';

const variant = process.argv[2];
if (
  ![
    'estimates',
    'crossing',
    'boundary',
    'floor-missing',
    'measurements-missing',
  ].includes(variant ?? '')
)
  throw Error('Unknown qualification case');
const directory = await mkdtemp(join(tmpdir(), 'billing-economics-sdk-'));
const window = { startsAt: month, endsAt: '2026-11-01T00:00:00.000Z' };
const reportPath = join(directory, `report-${'a'.repeat(24)}.json`);
const base = dataset();
const { modelUsage: _usage, volume: _volume, ...controlled } = base;
void _usage;
void _volume;
const estimates = estimateQualification();
const feed =
  variant === 'estimates'
    ? estimates.feed
    : {
        ...controlled,
        modelCostBasis: 'provider_invoice',
        volume: [],
        floorBasisPoints: variant === 'floor-missing' ? null : 3000,
        costs: [
          {
            ...base.costs[0],
            money: {
              kind: 'measured',
              amountMicros: variant === 'boundary' ? 7000000 : 7000001,
            },
          },
        ],
        coverage:
          variant === 'measurements-missing'
            ? controlled.coverage.filter((row) => row.category !== 'storage')
            : controlled.coverage,
      };
const snapshot =
  variant === 'estimates'
    ? estimates.snapshot
    : {
        ...window,
        observedAt: now,
        complete: true,
        attempts: [],
        usage: [],
      };
await writeFile(
  join(directory, 'assumptions.json'),
  JSON.stringify({
    variant,
    scope:
      'local TEST qualification, not production billing, workload or operator arrival',
    financialBasis:
      variant === 'estimates'
        ? estimateAssumptions
        : {
            kind: 'controlled_synthetic_TEST_financial_facts_not_supplier_measurements',
            revenueMicros: 10000000,
            costMicros: variant === 'boundary' ? 7000000 : 7000001,
            floorBasisPoints: 3000,
            window,
          },
  }),
  { mode: 0o600 },
);
await writeFile(join(directory, 'feed-2026-10.json'), JSON.stringify(feed), {
  mode: 0o600,
});
const files = createBillingEconomicsFiles({
  directory,
  now: () => now,
  nextId: () => 'a'.repeat(24),
});
const captureAfterSave: boolean[] = [],
  transportAfterSave: boolean[] = [];
const serialized: string[] = [];
let localTransport: ReturnType<typeof Sentry.createTransport> | undefined;
try {
  const initialized = initSentry({
    dsn: 'http://public@127.0.0.1:1/1',
    environment: 'billing-qualification-test',
    drawTraceSample: () => 1,
    transport: (options: Parameters<typeof Sentry.createTransport>[0]) => {
      localTransport = Sentry.createTransport(options, async (request) => {
        const body =
          typeof request.body === 'string'
            ? request.body
            : new TextDecoder().decode(request.body);
        if (body.length > 512 * 1024)
          throw Error('Qualification envelope exceeded bound');
        transportAfterSave.push(existsSync(reportPath));
        serialized.push(body);
        await writeFile(
          join(directory, `envelope-${serialized.length}.txt`),
          body,
          { mode: 0o600 },
        );
        return { statusCode: 200 };
      });
      return localTransport;
    },
  });
  const localTransportBound =
    localTransport !== undefined &&
    Sentry.getClient()?.getTransport() === localTransport;
  if (!localTransportBound) throw Error('Local SDK transport not bound');
  const reporter = createSentryErrorReporter();
  const result = await createBillingEconomicsCollector({
    store: { read: async () => snapshot },
    sink: files.sink,
    feed: files.feed,
    save: files.save,
    now: () => now,
  }).run(window);
  if (result.kind !== 'reported') throw Error('Qualification did not report');
  const raised = raiseEconomicsSignals(
    {
      capture: (error, context) => {
        captureAfterSave.push(existsSync(reportPath));
        reporter.capture(error, context);
      },
    },
    result,
  );
  const flushed = await Sentry.flush(1000);
  await Sentry.close(1000);
  const saved: unknown = JSON.parse(await readFile(reportPath, 'utf8'));
  const receipt = {
    variant,
    directory,
    initialized,
    flushed,
    sdkVersion: Sentry.SDK_VERSION,
    localTransportBound,
    captureAfterSave,
    transportAfterSave,
    reportMode: (await stat(reportPath)).mode & 0o777,
    directoryMode: (await stat(directory)).mode & 0o777,
    result,
    raised,
    saved,
    serialized,
    privateTelemetryLeaked: serialized.some((wire) =>
      wire
        .split('\n')
        .filter(Boolean)
        .some((line) => containsPrivateFields(JSON.parse(line))),
    ),
  };
  await writeFile(join(directory, 'receipt.json'), JSON.stringify(receipt), {
    mode: 0o600,
  });
  process.stdout.write(JSON.stringify(receipt));
} finally {
  await Sentry.close(1000);
}

function containsPrivateFields(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  return Object.entries(value).some(
    ([key, nested]) =>
      ([
        'user',
        'did',
        'email',
        'ip_address',
        'userId',
        'actorId',
        'roundId',
        'customerId',
        'chargeId',
        'amountMicros',
        'modelUsage',
        'revenueAfterRefunds',
      ].includes(key) &&
        nested !== null &&
        nested !== undefined &&
        JSON.stringify(nested) !== '{}') ||
      containsPrivateFields(nested),
  );
}
