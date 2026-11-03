/** Nearest rank, so every figure printed is a deadline that really happened. */
export const percentile = (samples: readonly number[], rank: number) => {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((rank / 100) * sorted.length) - 1)]!;
};

export const deadlineCell = (input: {
  readonly n: number;
  readonly profile: string;
  readonly required: number;
  readonly samplesMs: readonly number[];
  readonly missed: number;
}) => ({
  n: input.n,
  profile: input.profile,
  deadlines: input.samplesMs.length,
  missed: input.missed,
  required: input.required,
  valid: input.samplesMs.length >= input.required && input.missed === 0,
  p50Ms: percentile(input.samplesMs, 50),
  p95Ms: percentile(input.samplesMs, 95),
  p99Ms: percentile(input.samplesMs, 99),
  maxMs: input.samplesMs.length ? Math.max(...input.samplesMs) : null,
});

type LogLine = Readonly<Record<string, unknown>> & { readonly event?: unknown };
const number = (line: LogLine, field: string) => {
  const value = line[field];
  return typeof value === 'number' ? value : 0;
};
const text = (line: LogLine, field: string) => String(line[field] ?? 'unknown');
const total = (lines: readonly LogLine[], field: string) =>
  lines.reduce((sum, line) => sum + number(line, field), 0);
const worst = (lines: readonly LogLine[], field: string) =>
  Math.max(0, ...lines.map((line) => number(line, field)));
const grouped = (lines: readonly LogLine[], key: (line: LogLine) => string) => {
  const groups = new Map<string, LogLine[]>();
  for (const line of lines)
    groups.set(key(line), [...(groups.get(key(line)) ?? []), line]);
  return [...groups.values()];
};
const perChange = (value: number, moves: number) =>
  moves === 0 ? null : value / moves;

/** The server's own account of a run, from the events FLOOR-2 and ADR 0088 log. */
export const summarizeServerLog = (lines: readonly LogLine[]) => {
  const named = (event: string) => lines.filter((line) => line.event === event);
  const moves = named('round.media.floor_moved');
  const passes = named('round.media.pass');
  const passMs = total(passes, 'durationMs');
  return {
    refusals: grouped(
      named('db.capacity.refused'),
      (line) => `${text(line, 'cause')} ${text(line, 'operation')}`,
    ).map((group) => ({
      // `cause` is `<lane>.<reason>`, as capacityRefusalFields writes it.
      lane: text(group[0]!, 'cause').split('.')[0]!,
      reason: text(group[0]!, 'cause').split('.')[1] ?? 'unknown',
      operation: text(group[0]!, 'operation'),
      count: group.length,
    })),
    floorMoves: {
      tick: moves.filter((line) => line.mover === 'tick').length,
      browser: moves.filter((line) => line.mover === 'browser').length,
      capture: moves.filter((line) => line.mover === 'capture').length,
    },
    passes: passes.length,
    passesPerFloorChange: perChange(passes.length, moves.length),
    vendorCallsPerFloorChange: perChange(
      total(passes, 'vendorCalls') + total(passes, 'vendorCallsOutsidePasses'),
      moves.length,
    ),
    vendorShareOfPassTime:
      passMs === 0 ? null : total(passes, 'vendorMs') / passMs,
    lanes: grouped(named('db.lane.gauge'), (line) => text(line, 'lane')).map(
      (group) => ({
        lane: text(group[0]!, 'lane'),
        connections: number(group[0]!, 'connections'),
        activeMean: total(group, 'activeSum') / total(group, 'samples'),
        activeMax: worst(group, 'activeMax'),
        waitingMean: total(group, 'waitingSum') / total(group, 'samples'),
        waitingMax: worst(group, 'waitingMax'),
      }),
    ),
    holds: grouped(
      named('db.lane.hold'),
      (line) => `${text(line, 'lane')} ${text(line, 'operation')}`,
    )
      .map((group) => ({
        lane: text(group[0]!, 'lane'),
        operation: text(group[0]!, 'operation'),
        holds: total(group, 'holds'),
        totalMs: total(group, 'durationMs'),
        /** The worst five-second window's bucket bound, not a whole-run p95. */
        worstWindowP95Ms: worst(group, 'p95Ms'),
        maxMs: worst(group, 'maxMs'),
      }))
      .sort((a, b) => b.totalMs - a.totalMs),
  };
};

/** Whether the browserless Round moves its floor as a real browser's does. */
export const compareControl = (input: {
  readonly driverMs: readonly number[];
  readonly browserMs: readonly number[];
  readonly boundMs: number;
}) => {
  const driverP50Ms = percentile(input.driverMs, 50);
  const driverP95Ms = percentile(input.driverMs, 95);
  const browserP50Ms = percentile(input.browserMs, 50);
  const browserP95Ms = percentile(input.browserMs, 95);
  const gap = (a: number | null, b: number | null) =>
    a === null || b === null ? null : Math.abs(a - b);
  const p50GapMs = gap(browserP50Ms, driverP50Ms);
  const p95GapMs = gap(browserP95Ms, driverP95Ms);
  return {
    browserDeadlines: input.browserMs.length,
    browserP50Ms,
    browserP95Ms,
    driverP50Ms,
    driverP95Ms,
    p50GapMs,
    p95GapMs,
    boundMs: input.boundMs,
    agrees:
      p50GapMs !== null &&
      p95GapMs !== null &&
      p50GapMs <= input.boundMs &&
      p95GapMs <= input.boundMs,
  };
};
