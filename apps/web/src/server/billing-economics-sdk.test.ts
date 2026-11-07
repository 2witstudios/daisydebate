import { assert, setupRitewayBun, test } from 'riteway/bun';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { buildEconomicsReport } from '../features/billing/economics-report';
setupRitewayBun();
type Report = Extract<
  ReturnType<typeof buildEconomicsReport>,
  { kind: 'report' }
>;
type Receipt = {
  directory: string;
  variant: string;
  initialized: boolean;
  flushed: boolean;
  sdkVersion: string;
  localTransportBound: boolean;
  captureAfterSave: boolean[];
  transportAfterSave: boolean[];
  reportMode: number;
  directoryMode: number;
  privateTelemetryLeaked: boolean;
  serialized: string[];
  result: { kind: string; report: Report; alertDelivery: string };
  saved: { report: Report };
};
type Event = {
  tags: { errorCode: string; route: string };
  extra: { requestId: string };
  user?: unknown;
  exception?: { values?: { value?: string }[] };
};
function receivedEvents(wires: readonly string[]): Event[] {
  const events: Event[] = [];
  for (const wire of wires) {
    const lines = wire.split('\n');
    for (let i = 1; i + 1 < lines.length; i += 2) {
      const header = JSON.parse(lines[i]!) as { type: string };
      if (header.type === 'event')
        events.push(JSON.parse(lines[i + 1]!) as Event);
    }
  }
  return events;
}
for (const [variant, margin, low] of [
  ['estimates', 'estimate', false],
  ['crossing', 'below_floor', true],
  ['boundary', 'healthy', false],
  ['floor-missing', 'unknown', false],
  ['measurements-missing', 'unknown', false],
] as const) {
  test(`BILL17 ${variant}: private report and installed SDK local serialized delivery`, async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        '--conditions=node',
        new URL(
          '../features/telemetry/billing-economics-sdk.test-support.ts',
          import.meta.url,
        ).pathname,
        variant,
      ],
      { stdout: 'pipe', stderr: 'pipe', timeout: 4000 },
    );
    const [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    assert({
      given: 'isolated installed SDK11 and a closed in-memory transport',
      should:
        'finish within its bound without SDK errors or an external destination',
      actual: [exit, stderr],
      expected: [0, ''],
    });
    if (exit !== 0) return;
    const receipt = JSON.parse(stdout) as Receipt;
    if (!receipt.directory.startsWith(join(tmpdir(), 'billing-economics-sdk-')))
      throw Error('Unexpected own receipt directory');
    try {
      assertSdkReceipt(receipt, margin, low);
      if (variant === 'estimates') assertEstimatedFields(receipt);
    } finally {
      if (process.env.BILLING_ECONOMICS_TEST_RETAIN === '1')
        process.stdout.write(
          `BILL17_TEST_RECEIPT ${variant} ${receipt.directory}\n`,
        );
      else await rm(receipt.directory, { recursive: true, force: true });
    }
  });
}

function assertSdkReceipt(receipt: Receipt, margin: string, low: boolean) {
  const events = receivedEvents(receipt.serialized);
  assert({
    given:
      'the existing collector, private file sink, reporter mapping, beforeSend and real SDK serializer',
    should:
      'save before capture and transport, preserve unknowns/boundary, deliver only fixed scrubbed signals without personal or financial telemetry',
    actual: [
      receipt.initialized,
      receipt.flushed,
      receipt.sdkVersion,
      receipt.localTransportBound,
      receipt.directoryMode,
      receipt.reportMode,
      receipt.result.kind,
      receipt.result.alertDelivery,
      receipt.result.report.plans.premium.margin.kind,
      receipt.captureAfterSave.length > 0 &&
        receipt.captureAfterSave.every(Boolean),
      receipt.transportAfterSave.length > 0 &&
        receipt.transportAfterSave.every(Boolean),
      receipt.privateTelemetryLeaked,
      events.filter((event) => event.tags.errorCode === 'BILLING_LOW_MARGIN')
        .length,
      events.length > 0 &&
        events.every(
          (event) =>
            ['BILLING_LOW_MARGIN', 'BILLING_ECONOMICS_INCOMPLETE'].includes(
              event.tags.errorCode,
            ) &&
            /^billing\.economics\.(free|beta|premium)$/.test(
              event.tags.route,
            ) &&
            JSON.stringify(event.extra) ===
              JSON.stringify({ requestId: '2026-10' }) &&
            event.user === undefined &&
            Boolean(event.exception?.values?.length) &&
            event.exception!.values!.every(
              (value) => value.value === '[scrubbed]',
            ),
        ),
      JSON.stringify(receipt.saved.report) ===
        JSON.stringify(receipt.result.report),
    ],
    expected: [
      true,
      true,
      '11.10.0',
      true,
      0o700,
      0o600,
      'reported',
      'unconfirmed',
      margin,
      true,
      true,
      false,
      low ? 1 : 0,
      true,
      true,
    ],
  });
}

function assertEstimatedFields(receipt: Receipt) {
  const report = receipt.saved.report,
    premium = report.plans.premium;
  assert({
    given:
      'explicit hypothetical TEST assumptions, not actual supplier invoices or workload',
    should:
      'retain dated model/rate, original-month refund, disjoint allocation/storage/subsidy estimates together and leave absent knowledge unknown',
    actual: [
      premium.revenueAfterRefunds,
      premium.costs.models,
      premium.costs.storage,
      premium.costs.shared,
      premium.costs.freeTierSubsidy,
      report.sources.rates,
      report.sources.revenue.find((row) => row.kind === 'refund')?.sourceMonth,
      report.sources.revenue.find((row) => row.kind === 'refund')?.observedAt,
      report.sources.costs.find((row) => row.category === 'shared')?.allocation
        .rule,
      report.sources.costs.find((row) => row.category === 'freeTierSubsidy')
        ?.allocation.rule,
      report.plans.beta.costs.storage?.kind,
      report.volume.find(
        (row) => row.plan === 'premium' && row.feature === 'recording_download',
      ),
    ],
    expected: [
      { kind: 'estimated', amountMicros: 9000000 },
      { kind: 'estimated', amountMicros: 3000000 },
      { kind: 'estimated', amountMicros: 100000 },
      { kind: 'estimated', amountMicros: 750000 },
      { kind: 'estimated', amountMicros: 200000 },
      [
        {
          model: 'qualification-model',
          provider: 'qualification-provider',
          effectiveFrom: '2026-09-01T00:00:00.000Z',
          effectiveUntil: '2026-11-01T00:00:00.000Z',
          observedAt: '2026-11-06T00:00:00.000Z',
          provenance: 'catalog_estimate',
          inputMicrosPerMillion: 2000000,
          outputMicrosPerMillion: 10000000,
        },
      ],
      '2026-10-01T00:00:00.000Z',
      '2026-11-06T00:00:00.000Z',
      'usage_share',
      'free_subsidy',
      'unknown',
      {
        plan: 'premium',
        feature: 'recording_download',
        completed: null,
        possibleCalls: null,
        capacity: { kind: 'unknown' },
      },
    ],
  });
}
