import {
  mkdtemp,
  writeFile,
  readFile,
  stat,
  symlink,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { expect } from 'bun:test';
import { join } from 'node:path';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createBillingEconomicsFiles } from './billing-economics-files';
import { createBillingEconomicsCollector } from '../features/billing/economics-collector';
import { raiseEconomicsSignals } from '../features/billing/economics-alert';
import {
  dataset,
  month,
  now,
} from '../features/billing/economics.test-support';
import { reporterFrom } from '../features/telemetry/sentry-reporter';
import { scrubEvent } from '@daisy/observability';
setupRitewayBun();
const emptySnapshot = {
  startsAt: month,
  endsAt: '2026-11-01T00:00:00.000Z',
  observedAt: now,
  attempts: [],
  usage: [],
  complete: true,
};
test('private file measurements cross the real report sink and scrubbed reporter mapping without personal telemetry', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-proof-'));
  try {
    const { startsAt, endsAt, modelUsage: _m, volume: _v, ...feed } = dataset();
    void _m;
    void _v;
    await writeFile(
      join(directory, 'feed-2026-10.json'),
      JSON.stringify({
        startsAt,
        endsAt,
        ...feed,
        modelCostBasis: 'provider_invoice',
      }),
      { mode: 0o600 },
    );
    const files = createBillingEconomicsFiles({
      directory,
      now: () => now,
      nextId: () => 'a'.repeat(24),
    });
    const events: unknown[] = [];
    const reporter = reporterFrom((error, context) =>
      events.push(
        scrubEvent({
          exception: {
            values: [
              {
                type: 'Error',
                value: error instanceof Error ? error.message : 'invalid',
              },
            ],
          },
          ...context,
        }),
      ),
    );
    const collector = createBillingEconomicsCollector({
      store: {
        read: async () => ({
          startsAt,
          endsAt,
          observedAt: now,
          attempts: [],
          usage: [],
          complete: true,
        }),
      },
      sink: files.sink,
      feed: files.feed,
      save: files.save,
      now: () => now,
    });
    const r = await collector.run({ startsAt, endsAt });
    if (r.kind === 'reported') raiseEconomicsSignals(reporter, r);
    const output = join(directory, `report-${'a'.repeat(24)}.json`);
    const saved = JSON.parse(await readFile(output, 'utf8')) as {
      report: { plans: { premium: { margin: { kind: string } } } };
    };
    assert({
      given:
        'private measured file inputs with a known completed-month crossing',
      should:
        'persist a private report before delivering the named bounded signal through the existing scrubbed reporter',
      actual: [
        r.kind,
        saved.report.plans.premium.margin.kind,
        (await stat(output)).mode & 0o777,
        events.map(
          (e) => (e as { tags: { errorCode: string } }).tags.errorCode,
        ),
        JSON.stringify(events).includes('7000001'),
        JSON.stringify(events).includes('user'),
      ],
      expected: [
        'reported',
        'below_floor',
        0o600,
        [
          'BILLING_ECONOMICS_INCOMPLETE',
          'BILLING_ECONOMICS_INCOMPLETE',
          'BILLING_LOW_MARGIN',
        ],
        false,
        false,
      ],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('a missing feed is unknown and an unprivate or symlink feed cannot enter the reporting path', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-files-'));
  try {
    const files = createBillingEconomicsFiles({
      directory,
      now: () => now,
      nextId: () => 'b'.repeat(24),
    });
    const window = { startsAt: month, endsAt: '2026-11-01T00:00:00.000Z' };
    const missing = await files.feed.read(window);
    const target = join(directory, 'target.json'),
      path = join(directory, 'feed-2026-10.json');
    await writeFile(target, '{}', { mode: 0o600 });
    await symlink(target, path);
    await expect(files.feed.read(window)).rejects.toThrow(
      'Billing economics feed unavailable',
    );
    assert({
      given: 'no private feed and then a symbolic-link substitution',
      should:
        'return missing input explicitly and reject the substituted source',
      actual: [missing, true],
      expected: [null, true],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the private sink removes expired operational reports and refuses to overwrite a retained report', async () => {
  const { utimes } = await import('node:fs/promises');
  const directory = await mkdtemp(
    join(tmpdir(), 'billing-economics-retention-'),
  );
  try {
    const path = join(directory, `report-${'c'.repeat(24)}.json`);
    await writeFile(path, '{}', { mode: 0o600 });
    await utimes(
      path,
      new Date('2026-09-01T00:00:00.000Z'),
      new Date('2026-09-01T00:00:00.000Z'),
    );
    const files = createBillingEconomicsFiles({
      directory,
      now: () => now,
      nextId: () => 'c'.repeat(24),
    });
    await files.save({
      report: { kind: 'invalid', reason: 'invalid_input' },
      snapshot: emptySnapshot,
    });
    let refused = false;
    try {
      await files.save({
        report: { kind: 'invalid', reason: 'invalid_input' },
        snapshot: emptySnapshot,
      });
    } catch (error) {
      refused =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'EEXIST';
    }
    const stored = JSON.parse(await readFile(path, 'utf8')) as unknown;
    assert({
      given:
        'a report older than the existing thirty-day operational retention and then a colliding new receipt identity',
      should:
        'expire the old private file and preserve the new report immutably',
      actual: [stored, refused],
      expected: [
        {
          report: { kind: 'invalid', reason: 'invalid_input' },
          snapshot: emptySnapshot,
        },
        true,
      ],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

const window = { startsAt: month, endsAt: '2026-11-01T00:00:00.000Z' };
const refusalOf = (read: Promise<unknown>) =>
  read.then(
    () => null,
    (error: unknown) => (error instanceof Error ? error.message : null),
  );

test('a feed file whose body is null is invalid, never a missing feed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-files-'));
  try {
    const files = createBillingEconomicsFiles({
      directory,
      now: () => now,
      nextId: () => 'd'.repeat(24),
    });
    await writeFile(join(directory, 'feed-2026-10.json'), 'null', {
      mode: 0o600,
    });
    assert({
      given: 'a private feed file containing the JSON literal null',
      should:
        'refuse it as invalid rather than report the month as feed-missing',
      actual: await refusalOf(files.feed.read(window)),
      expected: 'Billing economics feed is invalid',
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the feed reader keeps its own privacy check without the sink being opened', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-files-'));
  try {
    const { chmod } = await import('node:fs/promises');
    await chmod(directory, 0o755);
    const files = createBillingEconomicsFiles({
      directory,
      now: () => now,
      nextId: () => 'e'.repeat(24),
    });
    assert({
      given: 'a group-readable directory read directly through feed.read',
      should: 'refuse it, as the sink would',
      actual: await refusalOf(files.feed.read(window)),
      expected: 'Billing economics directory is not private',
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
