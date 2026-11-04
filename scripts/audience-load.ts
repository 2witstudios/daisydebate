#!/usr/bin/env bun
/**
 * Load on the audience's poll routes, for comparing a live debate's floor timing
 * with and without an audience. See docs/operations/audience-load.md.
 *
 *   bun scripts/audience-load.ts --origin <url> --round <id> --viewers 1000 --seconds 120
 *   bun scripts/audience-load.ts floor <log file>
 *
 * A viewer's polls read the public bucket and reach no process of ours. This sends
 * what still reaches web: the Round's public page, once per viewer per
 * `--every-seconds`. It sends no cookie, as a viewer of a public Round does, and it
 * is open loop: a slow server does not slow
 * it, which is what a real crowd does.
 */
const VIEWER_EVERY_SECONDS = 2;
const TICK_MS = 10;
/** Past this many unanswered it counts a request as skipped rather than exhaust itself. */
const MAX_IN_FLIGHT = 4096;
const LOADABLE_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  'beta.daisydebate.com',
  'daisy-debate-staging.fly.dev',
]);

type LoadPlan = {
  readonly origin: string;
  readonly roundId: string;
  readonly requestsPerSecond: number;
  readonly seconds: number;
};
type Sample = { readonly status: number; readonly durationMs: number };

const optionOf = (args: readonly string[], name: string) => {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? undefined : args[at + 1];
};

export const parseLoadPlan = (args: readonly string[]): LoadPlan => {
  const origin = optionOf(args, 'origin') ?? '';
  const roundId = optionOf(args, 'round') ?? '';
  const viewers = Number(optionOf(args, 'viewers') ?? 1000);
  const seconds = Number(optionOf(args, 'seconds') ?? 120);
  const every = Number(optionOf(args, 'every-seconds') ?? VIEWER_EVERY_SECONDS);
  if (!URL.canParse(origin) || !LOADABLE_HOSTS.has(new URL(origin).hostname))
    throw new Error(`Refusing to load ${origin}: only local and staging`);
  if (roundId === '') throw new Error('--round is required');
  if (
    !(viewers > 0) ||
    !(seconds > 0) ||
    !(every > 0 && Number.isFinite(every))
  )
    throw new Error(
      '--viewers, --seconds and --every-seconds must be positive',
    );
  return {
    origin,
    roundId,
    requestsPerSecond: viewers / every,
    seconds,
  };
};

/** How many requests this instant owes, so the rate holds whatever a tick takes. */
export const dueRequests = (input: {
  readonly requestsPerSecond: number;
  readonly elapsedMs: number;
  readonly sent: number;
}): number =>
  Math.max(
    0,
    Math.floor((input.requestsPerSecond * input.elapsedMs) / 1000) - input.sent,
  );

const percentiles = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (share: number) =>
    sorted[Math.max(0, Math.ceil(sorted.length * share) - 1)] ?? 0;
  return { p50: at(0.5), p99: at(0.99), max: sorted.at(-1) ?? 0 };
};

const tally = (keys: readonly string[]) => {
  const counts: Record<string, number> = {};
  for (const key of keys) counts[key] = (counts[key] ?? 0) + 1;
  return counts;
};

export const summarizeLoad = (
  samples: readonly Sample[],
  run: { readonly skipped: number; readonly seconds: number },
) => ({
  sent: samples.length,
  skipped: run.skipped,
  perSecond: Math.round(samples.length / run.seconds),
  statuses: tally(samples.map((sample) => String(sample.status))),
  answeredMs: percentiles(
    samples
      .filter((sample) => sample.status === 200)
      .map((sample) => sample.durationMs),
  ),
});

type LogEntry = {
  readonly event?: string;
  readonly cause?: string;
  readonly durationMs?: number;
};

/** One log line as an entry: pino's own, or inside `fly logs -j`'s `message`. */
const entryOf = (line: string): LogEntry | null => {
  try {
    const parsed = JSON.parse(line) as LogEntry & { message?: unknown };
    return typeof parsed.event === 'string' ||
      typeof parsed.message !== 'string'
      ? parsed
      : entryOf(parsed.message);
  } catch {
    return null;
  }
};

/** What the floor did over a log: the numbers docs/operations/audience-load.md compares. */
export const summarizeFloorLog = (lines: readonly string[]) => {
  const entries = lines.flatMap((line) => entryOf(line) ?? []);
  const named = (event: string) =>
    entries.filter((entry) => entry.event === event);
  const durations = (rows: readonly LogEntry[]) =>
    rows.flatMap((row) => row.durationMs ?? []);
  const passes = named('round.media.floor_pass');
  const causes = (rows: readonly LogEntry[]) =>
    rows.flatMap((row) => row.cause ?? []);
  return {
    passes: passes.length,
    failedPasses: causes(passes).length,
    passMs: percentiles(durations(passes)),
    waitingByCause: tally(causes(named('round.media.floor_waiting'))),
    tickMs: percentiles(durations(named('round.media.floor_tick'))),
    refusedByLane: tally(
      causes(named('db.capacity.refused')).map(
        (cause) => cause.split('.')[0] ?? cause,
      ),
    ),
  };
};

const runLoad = async (plan: LoadPlan) => {
  const urls = [`${plan.origin}/watch/${encodeURIComponent(plan.roundId)}`];
  const samples: Sample[] = [];
  let sent = 0;
  let skipped = 0;
  let inFlight = 0;
  const pending = new Set<Promise<void>>();
  const send = (url: string) => {
    inFlight += 1;
    const started = performance.now();
    const work = fetch(url, { signal: AbortSignal.timeout(10_000) })
      .then(async (response) => {
        await response.arrayBuffer();
        return response.status;
      })
      .catch(() => 0)
      .then((status) => {
        samples.push({
          status,
          durationMs: Math.round(performance.now() - started),
        });
        inFlight -= 1;
        pending.delete(work);
      });
    pending.add(work);
  };
  const start = performance.now();
  const endAt = start + plan.seconds * 1000;
  while (performance.now() < endAt) {
    const owed = dueRequests({
      requestsPerSecond: plan.requestsPerSecond,
      elapsedMs: performance.now() - start,
      sent: sent + skipped,
    });
    for (let index = 0; index < owed; index += 1) {
      if (inFlight >= MAX_IN_FLIGHT) skipped += 1;
      else {
        send(urls[(sent + skipped) % urls.length]!);
        sent += 1;
      }
    }
    await Bun.sleep(TICK_MS);
  }
  await Promise.all(pending);
  return summarizeLoad(samples, { skipped, seconds: plan.seconds });
};

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args[0] === 'floor') {
    const text = await Bun.file(args[1] ?? '').text();
    console.log(JSON.stringify(summarizeFloorLog(text.split('\n')), null, 2));
  } else {
    const plan = parseLoadPlan(args);
    console.log(
      `Loading ${plan.origin} round ${plan.roundId} at ${plan.requestsPerSecond} requests a second for ${plan.seconds} s`,
    );
    console.log(JSON.stringify(await runLoad(plan), null, 2));
  }
}
