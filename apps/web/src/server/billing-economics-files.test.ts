import {
  mkdtemp,
  writeFile,
  readFile,
  stat,
  symlink,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
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
import { buildEconomicsReport } from '../features/billing/economics-report';
import { scrubEvent } from '@daisy/observability';
import { isAppError } from '@daisy/errors';
setupRitewayBun();
const window = { startsAt: month, endsAt: '2026-11-01T00:00:00.000Z' };
/** The closed reason a read refused with, or null if it did not refuse. */
const reasonOf = (read: Promise<unknown>) =>
  read.then(
    () => null,
    (error: unknown) =>
      isAppError(error) ? [error.code, error.reason].join(':') : 'untyped',
  );
const built = buildEconomicsReport(dataset(), now);
if (built.kind !== 'report') throw Error('Expected a valid report');
const savedReport = built;
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
    assert({
      given: 'no private feed and then a symbolic-link substitution',
      should:
        'return missing input explicitly and reject the substituted source',
      actual: [missing, await reasonOf(files.feed.read(window))],
      expected: [null, 'VALIDATION:economics-feed-not-private'],
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
      report: savedReport,
      snapshot: emptySnapshot,
    });
    let refused = false;
    try {
      await files.save({
        report: savedReport,
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
          report: savedReport,
          snapshot: emptySnapshot,
        },
        true,
      ],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a symlinked, group-readable, non-regular or oversized feed is refused by its reason', async () => {
  const { mkdir } = await import('node:fs/promises');
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-files-'));
  try {
    const files = createBillingEconomicsFiles({
      directory,
      now: () => now,
      nextId: () => 'h'.repeat(24),
    });
    const path = join(directory, 'feed-2026-10.json');
    const target = join(directory, 'target.json');
    await writeFile(target, '{}', { mode: 0o600 });
    await symlink(target, path);
    const linked = await reasonOf(files.feed.read(window));
    await rm(path);
    await writeFile(path, '{}', { mode: 0o644 });
    const readable = await reasonOf(files.feed.read(window));
    await rm(path);
    await mkdir(path, { mode: 0o700 });
    const notFile = await reasonOf(files.feed.read(window));
    await rm(path, { recursive: true });
    await writeFile(path, ' '.repeat(1024 * 1024 + 1), { mode: 0o600 });
    const oversized = await reasonOf(files.feed.read(window));
    assert({
      given:
        "a symlink in the feed's place, a mode-0644 feed, a directory named as the feed, and a feed over 1 MiB",
      should: 'refuse the first three as not private and the last as too large',
      actual: [linked, readable, notFile, oversized],
      expected: [
        'VALIDATION:economics-feed-not-private',
        'VALIDATION:economics-feed-not-private',
        'VALIDATION:economics-feed-not-private',
        'VALIDATION:economics-feed-too-large',
      ],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a save during a late correction never expires the feed it is correcting', async () => {
  const { utimes, readdir } = await import('node:fs/promises');
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-files-'));
  try {
    const august = join(directory, 'feed-2026-08.json');
    await writeFile(august, '{}', { mode: 0o600 });
    const old = new Date('2026-09-01T00:00:00.000Z');
    await utimes(august, old, old);
    const files = createBillingEconomicsFiles({
      directory,
      now: () => now,
      nextId: () => 'k'.repeat(24),
    });
    await files.save({
      report: {
        ...savedReport,
        startsAt: '2026-08-01T00:00:00.000Z',
        endsAt: '2026-09-01T00:00:00.000Z',
      },
      snapshot: emptySnapshot,
    });
    assert({
      given:
        'an August feed past the thirty-day retention, and a saved August report',
      should: 'keep the August feed for the next correction run',
      actual: (await readdir(directory)).includes('feed-2026-08.json'),
      expected: true,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a feed whose collection window has passed is removed whatever its age', async () => {
  const { readdir } = await import('node:fs/promises');
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-files-'));
  try {
    const { utimes } = await import('node:fs/promises');
    // Written an hour before the sweep, far inside 30 days.
    const written = new Date(Date.parse(now) - 3600000);
    for (const name of ['feed-2026-09.json', 'feed-2026-10.json']) {
      await writeFile(join(directory, name), '{}', { mode: 0o600 });
      await utimes(join(directory, name), written, written);
    }
    const files = createBillingEconomicsFiles({
      directory,
      now: () => now,
      nextId: () => 'v'.repeat(24),
    });
    await files.feed.read(window);
    assert({
      given:
        'September and October feeds written an hour earlier, swept in November while October is collected',
      should:
        'remove September, whose collection window has passed, and keep October',
      actual: (await readdir(directory)).sort(),
      expected: ['feed-2026-10.json'],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a feed that is not JSON is refused as unparseable, keeping the parser error', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-files-'));
  try {
    await writeFile(join(directory, 'feed-2026-10.json'), '{"startsAt": ,}', {
      mode: 0o600,
    });
    const files = createBillingEconomicsFiles({
      directory,
      now: () => now,
      nextId: () => 'p'.repeat(24),
    });
    const caught = await files.feed.read(window).then(
      () => null,
      (error: unknown) => error,
    );
    assert({
      given: 'a feed with a stray comma',
      should:
        'refuse it as VALIDATION economics-feed-unparseable with the SyntaxError as cause',
      actual: isAppError(caught) && [
        caught.code,
        caught.reason,
        caught.cause instanceof SyntaxError,
      ],
      expected: ['VALIDATION', 'economics-feed-unparseable', true],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a feed for a month that has not started is never retained', async () => {
  const { readdir } = await import('node:fs/promises');
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-files-'));
  try {
    for (const name of ['feed-2026-11.json', 'feed-2026-12.json'])
      await writeFile(join(directory, name), '{}', { mode: 0o600 });
    const files = createBillingEconomicsFiles({
      directory,
      now: () => now,
      nextId: () => 'q'.repeat(24),
    });
    await files.feed.read(window);
    assert({
      given:
        'in November, a feed for November and one placed early for December',
      should:
        'keep November, whose window is open, and remove December, so no feed outlives the month after its own (DEC-372)',
      actual: (await readdir(directory)).sort(),
      expected: ['feed-2026-11.json'],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
