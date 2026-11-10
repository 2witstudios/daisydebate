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
import { buildEconomicsReport } from '../features/billing/economics-report';
import { scrubEvent } from '@daisy/observability';
setupRitewayBun();
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
      'Billing economics feed is not bounded and private',
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
      expected: 'Billing economics feed body is null',
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
      should:
        'refuse it as the sink being unavailable, keeping the privacy refusal as its cause',
      actual: await files.feed.read(window).then(
        () => null,
        (error: unknown) =>
          error instanceof Error && error.cause instanceof Error
            ? [
                (error as { code?: string }).code,
                error.message,
                error.cause.message,
              ]
            : null,
      ),
      expected: [
        'INFRASTRUCTURE',
        'Billing economics sink unavailable to the feed reader',
        'Billing economics directory is not private',
      ],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('opening the sink runs retention even when the collection never reaches save', async () => {
  const { utimes, readdir } = await import('node:fs/promises');
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-files-'));
  try {
    const expired = join(directory, `report-${'f'.repeat(24)}.json`);
    await writeFile(expired, '{}', { mode: 0o600 });
    await utimes(
      expired,
      new Date('2026-09-01T00:00:00.000Z'),
      new Date('2026-09-01T00:00:00.000Z'),
    );
    const files = createBillingEconomicsFiles({
      directory,
      now: () => now,
      nextId: () => 'f'.repeat(24),
    });
    await files.sink.open(window);
    assert({
      given:
        'a report older than the thirty-day retention and a sink opened without a save',
      should: 'remove the expired file on open',
      actual: await readdir(directory),
      expected: [],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('retention never expires the feed of the month still being collected', async () => {
  const { utimes, readdir } = await import('node:fs/promises');
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-files-'));
  try {
    const old = new Date('2026-09-01T00:00:00.000Z');
    for (const name of ['feed-2026-10.json', 'feed-2026-08.json']) {
      await writeFile(join(directory, name), '{}', { mode: 0o600 });
      await utimes(join(directory, name), old, old);
    }
    const files = createBillingEconomicsFiles({
      directory,
      now: () => now,
      nextId: () => 'g'.repeat(24),
    });
    await files.sink.open(window);
    assert({
      given:
        'two feeds past the thirty-day retention: October (still being collected) and August',
      should: 'keep October and expire August',
      actual: (await readdir(directory)).sort(),
      expected: ['feed-2026-10.json'],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

const codeOf = (read: Promise<unknown>) =>
  read.then(
    () => null,
    (error: unknown) =>
      typeof error === 'object' && error !== null && 'code' in error
        ? error.code
        : 'untyped',
  );

test("a symlinked, group-readable or non-regular feed is VALIDATION, the operator's file being wrong", async () => {
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
    const linked = await codeOf(files.feed.read(window));
    await rm(path);
    await writeFile(path, '{}', { mode: 0o644 });
    const readable = await codeOf(files.feed.read(window));
    await rm(path);
    await mkdir(path, { mode: 0o700 });
    const notFile = await codeOf(files.feed.read(window));
    assert({
      given:
        "a symlink in the feed's place, a mode-0644 feed, and a directory named as the feed",
      should:
        'refuse each as a VALIDATION error, so the collector says feed_invalid',
      actual: [linked, readable, notFile],
      expected: ['VALIDATION', 'VALIDATION', 'VALIDATION'],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('retention keeps the feeds of the collected and the current month', async () => {
  const { utimes, readdir } = await import('node:fs/promises');
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-files-'));
  try {
    const old = new Date('2026-08-01T00:00:00.000Z');
    for (const name of [
      'feed-2026-06.json',
      'feed-2026-07.json',
      'feed-2026-11.json',
    ]) {
      await writeFile(join(directory, name), '{}', { mode: 0o600 });
      await utimes(join(directory, name), old, old);
    }
    const files = createBillingEconomicsFiles({
      directory,
      now: () => now,
      nextId: () => 'i'.repeat(24),
    });
    await files.sink.open({
      startsAt: '2026-07-01T00:00:00.000Z',
      endsAt: '2026-08-01T00:00:00.000Z',
    });
    assert({
      given:
        'expired-age feeds for June, July (a late correction being collected) and November (not yet collected)',
      should:
        'keep July (being collected) and November (the current month), and expire June',
      actual: (await readdir(directory)).sort(),
      expected: ['feed-2026-07.json', 'feed-2026-11.json'],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a feed this process may not read is VALIDATION, the operator's file being wrong", async () => {
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-files-'));
  try {
    // The open refusal is injected, so it holds on every runner, root included.
    const files = createBillingEconomicsFiles({
      directory,
      now: () => now,
      nextId: () => 'j'.repeat(24),
      openFeed: async () => {
        throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      },
    });
    assert({
      given: 'a feed file this process is refused permission to open',
      should:
        'refuse it as VALIDATION (feed_invalid) with its own reason, keeping the errno',
      actual: await files.feed.read(window).then(
        () => null,
        (error: unknown) =>
          error instanceof Error
            ? [
                (error as { code?: string }).code,
                (error as { reason?: string }).reason,
                (error.cause as { code?: string } | undefined)?.code,
              ]
            : null,
      ),
      expected: ['VALIDATION', 'economics-feed-forbidden', 'EACCES'],
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

test('a malformed feed keeps the parser error as its cause', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-files-'));
  try {
    await writeFile(join(directory, 'feed-2026-10.json'), '{"startsAt":', {
      mode: 0o600,
    });
    const files = createBillingEconomicsFiles({
      directory,
      now: () => now,
      nextId: () => 'l'.repeat(24),
    });
    assert({
      given: 'a truncated JSON feed',
      should: 'refuse it as VALIDATION with the SyntaxError as its cause',
      actual: await files.feed.read(window).then(
        () => null,
        (error: unknown) =>
          error instanceof Error && error.cause instanceof SyntaxError,
      ),
      expected: true,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a refused feed open keeps its errno as the cause', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-files-'));
  try {
    const target = join(directory, 'target.json');
    await writeFile(target, '{}', { mode: 0o600 });
    await symlink(target, join(directory, 'feed-2026-10.json'));
    const files = createBillingEconomicsFiles({
      directory,
      now: () => now,
      nextId: () => 'm'.repeat(24),
    });
    assert({
      given: "a symlink in the feed's place, refused by O_NOFOLLOW",
      should: 'refuse it as VALIDATION whose cause keeps the ELOOP errno',
      actual: await codeOf(
        files.feed.read(window).catch((error: unknown) => {
          throw error instanceof Error ? error.cause : error;
        }),
      ),
      expected: 'ELOOP',
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('opening the sink refuses a malformed window before retention runs', async () => {
  const { utimes, readdir } = await import('node:fs/promises');
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-files-'));
  try {
    const feedPath = join(directory, 'feed-2026-10.json');
    await writeFile(feedPath, '{}', { mode: 0o600 });
    const old = new Date('2026-08-01T00:00:00.000Z');
    await utimes(feedPath, old, old);
    const files = createBillingEconomicsFiles({
      directory,
      now: () => now,
      nextId: () => 'n'.repeat(24),
    });
    const refused = await codeOf(
      files.sink.open({ startsAt: 'x2026-10', endsAt: 'x2026-11' }),
    );
    assert({
      given: 'a malformed window and an expired-age feed',
      should: 'refuse as INTERNAL and leave the feed in place',
      actual: [refused, await readdir(directory)],
      expected: ['INTERNAL', ['feed-2026-10.json']],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a misnamed far-future feed is not protected forever', async () => {
  const { utimes, readdir } = await import('node:fs/promises');
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-files-'));
  try {
    const old = new Date('2026-08-01T00:00:00.000Z');
    for (const name of ['feed-2099-01.json', 'feed-2026-11.json']) {
      await writeFile(join(directory, name), '{}', { mode: 0o600 });
      await utimes(join(directory, name), old, old);
    }
    const files = createBillingEconomicsFiles({
      directory,
      now: () => now,
      nextId: () => 'o'.repeat(24),
    });
    await files.sink.open(window);
    assert({
      given: 'expired-age feeds for January 2099 and for the current month',
      should: 'expire the far-future feed and keep the current month',
      actual: (await readdir(directory)).sort(),
      expected: ['feed-2026-11.json'],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('opening the sink refuses a malformed end instant before retention runs', async () => {
  const { utimes, readdir } = await import('node:fs/promises');
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-files-'));
  try {
    const expired = join(directory, `report-${'p'.repeat(24)}.json`);
    await writeFile(expired, '{}', { mode: 0o600 });
    const old = new Date('2026-08-01T00:00:00.000Z');
    await utimes(expired, old, old);
    const files = createBillingEconomicsFiles({
      directory,
      now: () => now,
      nextId: () => 'p'.repeat(24),
    });
    const refused = await codeOf(
      files.sink.open({ startsAt: month, endsAt: 'bogus' }),
    );
    assert({
      given:
        'a valid start instant, a malformed end instant, and an expired report',
      should: 'refuse as INTERNAL before any sweep, leaving the report',
      actual: [refused, (await readdir(directory)).length],
      expected: ['INTERNAL', 1],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a sink directory this process cannot use is refused as unusable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-files-'));
  try {
    // The usability refusal is injected, so it holds on every runner, root included.
    const files = createBillingEconomicsFiles({
      directory,
      now: () => now,
      nextId: () => 'q'.repeat(24),
      accessDirectory: async () => {
        throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      },
    });
    assert({
      given: 'a private sink directory this process is refused access to',
      should:
        'refuse at open as economics-sink-unusable, before any file inside, keeping the errno',
      actual: await files.sink.open(window).then(
        () => null,
        (error: unknown) =>
          error instanceof Error
            ? [
                (error as { reason?: string }).reason,
                (error.cause as { code?: string } | undefined)?.code,
              ]
            : null,
      ),
      expected: ['economics-sink-unusable', 'EACCES'],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a full sink is refused at open, before any database read', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-files-'));
  try {
    for (let n = 0; n < 1000; n++)
      await writeFile(join(directory, `fill-${n}.txt`), '', { mode: 0o600 });
    const files = createBillingEconomicsFiles({
      directory,
      now: () => now,
      nextId: () => 'r'.repeat(24),
    });
    assert({
      given: 'a sink holding 1000 retained entries',
      should: 'refuse at open as economics-sink-full',
      actual: await files.sink.open(window).then(
        () => null,
        (error: unknown) => (error as { reason?: string }).reason ?? null,
      ),
      expected: 'economics-sink-full',
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a sink that cannot be created is its own refusal, keeping the errno', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'billing-economics-files-'));
  const files = createBillingEconomicsFiles({
    directory: join(parent, 'sink'),
    now: () => now,
    nextId: () => 's'.repeat(24),
  });
  try {
    // A file where the parent directory should be makes mkdir fail on any runner, root included.
    await rm(parent, { recursive: true, force: true });
    await writeFile(parent, '', { mode: 0o600 });
    assert({
      given: 'a sink path whose parent is a file, not a directory',
      should: 'refuse as economics-sink-uncreatable with the errno as cause',
      actual: await files.sink.open(window).then(
        () => null,
        (error: unknown) =>
          error instanceof Error
            ? [
                (error as { reason?: string }).reason,
                typeof (error.cause as { code?: string } | undefined)?.code,
              ]
            : null,
      ),
      expected: ['economics-sink-uncreatable', 'string'],
    });
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test('a feed placed on the first of its month survives until it is collected', async () => {
  const { utimes, readdir } = await import('node:fs/promises');
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-files-'));
  try {
    const october = join(directory, 'feed-2026-10.json');
    await writeFile(october, '{}', { mode: 0o600 });
    const placed = new Date('2026-10-01T00:30:00.000Z');
    await utimes(october, placed, placed);
    const files = createBillingEconomicsFiles({
      directory,
      now: () => '2026-10-31T01:00:00.000Z',
      nextId: () => 't'.repeat(24),
    });
    // On Oct 31 the worker still collects September.
    await files.sink.open({
      startsAt: '2026-09-01T00:00:00.000Z',
      endsAt: '2026-10-01T00:00:00.000Z',
    });
    assert({
      given:
        'an October feed placed on Oct 1, swept on Oct 31 while September is collected',
      should: "keep it for October's collection in November",
      actual: await readdir(directory),
      expected: ['feed-2026-10.json'],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a disk fault while checking or creating the sink stays untyped, keeping its errno', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-files-'));
  const eio = () => Object.assign(new Error('i/o error'), { code: 'EIO' });
  const opened = (seams: {
    readonly accessDirectory?: () => Promise<void>;
    readonly makeDirectory?: () => Promise<unknown>;
  }) =>
    createBillingEconomicsFiles({
      directory,
      now: () => now,
      nextId: () => 'u'.repeat(24),
      ...seams,
    })
      .sink.open(window)
      .then(
        () => null,
        (error: unknown) =>
          error instanceof Error
            ? [
                (error as { code?: string }).code,
                (error as { reason?: string }).reason ?? null,
              ]
            : null,
      );
  try {
    assert({
      given:
        'an EIO from the usability check, then an EIO from creating the sink',
      should:
        'rethrow each original untyped error, never a typed setup refusal',
      actual: [
        await opened({
          accessDirectory: async () => {
            throw eio();
          },
        }),
        await opened({
          makeDirectory: async () => {
            throw eio();
          },
        }),
      ],
      expected: [
        ['EIO', null],
        ['EIO', null],
      ],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a feed whose collection window has passed is removed whatever its age', async () => {
  const { readdir } = await import('node:fs/promises');
  const directory = await mkdtemp(join(tmpdir(), 'billing-economics-files-'));
  try {
    for (const name of ['feed-2026-09.json', 'feed-2026-10.json'])
      await writeFile(join(directory, name), '{}', { mode: 0o600 });
    const files = createBillingEconomicsFiles({
      directory,
      now: () => now,
      nextId: () => 'v'.repeat(24),
    });
    await files.sink.open(window);
    assert({
      given:
        'freshly written September and October feeds, swept in November while October is collected',
      should:
        'remove September, whose collection window has passed, and keep October',
      actual: (await readdir(directory)).sort(),
      expected: ['feed-2026-10.json'],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
