import { CAPTURE_COVERAGE_TOLERANCE } from '@daisy/protocol';
import { z } from 'zod';
import { incidentRate, percentile } from './measure';

const seatSchema = z.strictObject({
  seat: z.enum(['first-speaker', 'second-speaker']),
  lostMs: z.number().nullable(),
  backMs: z.number().nullable(),
  relapses: z.number(),
  udpBefore: z.boolean(),
  udpAfter: z.boolean().nullable(),
  /** What the seat's own page did, for telling a slow rejoin from none at all. */
  admissionsAfterKill: z.number(),
  admissionStatuses: z.array(z.number()),
  lastStatuses: z.array(z.string()),
});
const streamSchema = z.strictObject({
  state: z.enum(['open', 'complete', 'partial']),
  partialReasons: z.array(z.string()),
  gapCount: z.number(),
  gapMs: z.number(),
  missingMs: z.number(),
});
const coverageSchema = z.strictObject({
  owedMs: z.number(),
  observedMs: z.number(),
  missingMs: z.number(),
  coverage: z.number().nullable(),
  missingOutsideOutageMs: z.number(),
  coverageOutsideOutage: z.number().nullable(),
  /** Owed time with no capture, in ms from the kill. */
  holes: z.array(z.object({ start: z.number(), end: z.number() })),
});
/** One kill and what it did; a sample whose kill never fired says why. */
export const drillSampleSchema = z.strictObject({
  index: z.number(),
  moment: z.enum(['mid-speech', 'floor-change']),
  killed: z.boolean(),
  node: z.string().nullable(),
  roundId: z.string().nullable(),
  killCommandMs: z.number().nullable(),
  seats: z.array(seatSchema),
  captureBackMs: z.number().nullable(),
  coverage: coverageSchema.nullable(),
  streams: z.array(streamSchema),
  penalties: z.number().nullable(),
  roundStatus: z.string().nullable(),
  roundMs: z.number(),
  incidents: z.number().nullable(),
  /** Airtime the incident gave back, in all. */
  returnedMs: z.number().nullable(),
  /** Speech after the kill that the resume point did not return. */
  airtimeLostMs: z.number().nullable(),
  killSentAt: z.string().nullable(),
  unsafeSeen: z.boolean().nullable(),
  /** The spike's failure bar: still unsafe a minute after the kill. */
  unsafeAfter60s: z.boolean().nullable(),
  nodeBackMs: z.number().nullable(),
  nodeStartedBy: z.enum(['platform', 'drill']).nullable(),
  errors: z.array(z.string()),
});
const killedAirtime = (report: {
  readonly airtime: { readonly maxLostMs: number; readonly returnedMs: number };
}) =>
  `${seconds(report.airtime.returnedMs)} returned in all; at most ${seconds(report.airtime.maxLostMs)} lost after a kill.`;

export type DrillSample = z.infer<typeof drillSampleSchema>;

const SEAT_BACK_BAR_MS = 15_000;
const CAPTURE_BACK_BAR_MS = 30_000;
/** Detection cannot be instant, and the resume point is the last confirmed audio before it. */
const AIRTIME_LOST_BAR_MS = 2_000;
const UNRECOVERED_BAR_MS = 60_000;
/** What the capture rule itself allows a complete stream at its two edges (DEC-218, DEC-220). */
const HONEST_GAP_TOLERANCE_MS =
  CAPTURE_COVERAGE_TOLERANCE.joinMs + CAPTURE_COVERAGE_TOLERANCE.relayMs;

type Verdict = 'pass' | 'fail' | 'not-run';
const verdict = (ran: boolean, holds: boolean): Verdict =>
  !ran ? 'not-run' : holds ? 'pass' : 'fail';

const summaryOf = (samples: readonly (number | null)[]) => {
  const numbers = samples.filter((sample) => sample !== null);
  return {
    n: samples.length,
    unrecovered: samples.length - numbers.length,
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    max: samples.length
      ? numbers.length === samples.length
        ? Math.max(...numbers)
        : null
      : null,
  };
};

const sum = (values: readonly number[]) =>
  values.reduce((total, value) => total + value, 0);

const isHonest = (stream: DrillSample['streams'][number]) =>
  stream.state !== 'open' &&
  (stream.missingMs <= HONEST_GAP_TOLERANCE_MS ||
    (stream.state === 'partial' && stream.gapCount > 0));

/** The JSON report: summaries with their sample sizes, every bar, and what did not run. */
export function buildDrillReport(input: {
  readonly label: string;
  readonly commit: string;
  readonly nodes: readonly string[];
  readonly planned: number;
  readonly samples: readonly DrillSample[];
}) {
  const killed = input.samples.filter((sample) => sample.killed);
  const seats = killed.flatMap((sample) => sample.seats);
  const seatBack = seats.map((seat) => seat.backMs);
  const captureBack = killed.map((sample) => sample.captureBackMs);
  const coverages = killed.flatMap((sample) =>
    sample.coverage ? [sample.coverage] : [],
  );
  const owedMs = sum(coverages.map((entry) => entry.owedMs));
  const observedMs = sum(coverages.map((entry) => entry.observedMs));
  const missingOutside = sum(
    coverages.map((entry) => entry.missingOutsideOutageMs),
  );
  const roundMs = sum(killed.map((sample) => sample.roundMs));
  const incidentCounts = killed.map((sample) => sample.incidents);
  const incidents = incidentCounts.some((count) => count === null)
    ? null
    : sum(incidentCounts as number[]);
  const streams = killed.flatMap((sample) => sample.streams);
  const ran = killed.length > 0;
  const seatP95 = percentile(seatBack, 95);
  return {
    label: input.label,
    commit: input.commit,
    nodes: input.nodes,
    killsPlanned: input.planned,
    killsRun: killed.length,
    measuredFrom:
      'the moment the kill command was sent; each sample also states how long that command took',
    seatBackMs: summaryOf(seatBack),
    captureBackMs: summaryOf(captureBack),
    captureCoverage: {
      n: coverages.length,
      owedMs,
      observedMs,
      coverage: owedMs ? observedMs / owedMs : null,
      missingOutsideOutageMs: missingOutside,
    },
    airtime: {
      returnedMs: killed.reduce(
        (sum, sample) => sum + (sample.returnedMs ?? 0),
        0,
      ),
      maxLostMs: Math.max(
        0,
        ...killed.map((sample) => sample.airtimeLostMs ?? 0),
      ),
    },
    incidents: {
      n: killed.length,
      count: incidents,
      roundHours: roundMs / 3_600_000,
      per1000RoundHours: incidentRate(incidents, roundMs),
    },
    udp: {
      n: seats.length,
      directUdpBeforeKill: seats.filter((seat) => seat.udpBefore).length,
      recovered: seats.filter((seat) => seat.udpAfter !== null).length,
      directUdpAfterRecovery: seats.filter((seat) => seat.udpAfter === true)
        .length,
    },
    nodeBackMs: summaryOf(killed.map((sample) => sample.nodeBackMs)),
    nodeStartedBy: killed.map((sample) => sample.nodeStartedBy),
    bars: {
      seatsBackWithin15sP95: verdict(
        ran,
        seatP95 !== null && seatP95 <= SEAT_BACK_BAR_MS,
      ),
      captureBackWithin30s: verdict(
        ran,
        captureBack.every(
          (back) => back !== null && back <= CAPTURE_BACK_BAR_MS,
        ),
      ),
      sealedHonestly: verdict(streams.length > 0, streams.every(isHonest)),
      everyKillPausedTheRound: verdict(
        ran,
        killed.every((sample) => (sample.incidents ?? 0) > 0),
      ),
      noAirtimeLost: verdict(
        ran,
        killed.every(
          (sample) => (sample.airtimeLostMs ?? 0) <= AIRTIME_LOST_BAR_MS,
        ),
      ),
      noAttendancePenalty: verdict(
        ran,
        killed.every((sample) => sample.penalties === 0),
      ),
      roundCompletes: verdict(
        ran,
        killed.every((sample) => sample.roundStatus === 'completed'),
      ),
      neverUnsafeOrUnrecoveredAfter60s: verdict(
        ran,
        killed.every((sample) => sample.unsafeAfter60s === false) &&
          seatBack.every((back) => back !== null && back <= UNRECOVERED_BAR_MS),
      ),
    },
    notRun: input.samples
      .filter((sample) => !sample.killed)
      .map((sample) => ({
        index: sample.index,
        moment: sample.moment,
        errors: sample.errors,
      })),
    samples: input.samples,
  };
}
export type DrillReport = ReturnType<typeof buildDrillReport>;

const seconds = (ms: number | null) =>
  ms === null ? 'none' : `${(ms / 1000).toFixed(1)} s`;
const percent = (value: number | null) =>
  value === null ? 'none' : `${(value * 100).toFixed(1)}%`;

/** The short table for a person: one row per kill, then the summary and the bars. */
export function drillReportTable(report: DrillReport) {
  const rows = report.samples.map((sample) => {
    if (!sample.killed)
      return `| ${sample.index + 1} | ${sample.moment} | not run | | | | | | |`;
    const seats = sample.seats.map((seat) => seats_(seat.backMs)).join(', ');
    return `| ${sample.index + 1} | ${sample.moment} | ${sample.node} | ${seats} | ${seconds(sample.captureBackMs)} | ${percent(sample.coverage?.coverage ?? null)} | ${sample.roundStatus ?? 'none'} | ${sample.penalties ?? 'none'} | ${seconds(sample.nodeBackMs)} (${sample.nodeStartedBy ?? 'none'}) |`;
  });
  return [
    `Node kill drill "${report.label}" at ${report.commit}: ${report.killsRun} of ${report.killsPlanned} kills ran.`,
    '',
    '| # | When | Node | Seats back | Capture back | Coverage | Round | Penalties | Node back |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows,
    '',
    `Seats back: p50 ${seconds(report.seatBackMs.p50)}, p95 ${seconds(report.seatBackMs.p95)}, max ${seconds(report.seatBackMs.max)}, n=${report.seatBackMs.n}, unrecovered ${report.seatBackMs.unrecovered}.`,
    `Capture back: p95 ${seconds(report.captureBackMs.p95)}, max ${seconds(report.captureBackMs.max)}, n=${report.captureBackMs.n}, unrecovered ${report.captureBackMs.unrecovered}.`,
    `Capture coverage: ${percent(report.captureCoverage.coverage)} of ${seconds(report.captureCoverage.owedMs)} owed, n=${report.captureCoverage.n} Rounds; ${seconds(report.captureCoverage.missingOutsideOutageMs)} missing outside the outages.`,
    `Incidents: ${report.incidents.count ?? 'no table to read'}, over ${report.incidents.roundHours.toFixed(3)} Round-hours, rate ${report.incidents.per1000RoundHours?.toFixed(0) ?? 'none'} per 1,000 Round-hours, n=${report.incidents.n}.`,
    `Airtime: ${killedAirtime(report)}`,
    `Direct UDP: ${report.udp.directUdpBeforeKill} of ${report.udp.n} seats before the kill, ${report.udp.directUdpAfterRecovery} of ${report.udp.recovered} recovered seats after.`,
    '',
    ...Object.entries(report.bars).map(
      ([bar, result]) => `- ${bar}: ${result}`,
    ),
    ...report.notRun.map(
      (entry) =>
        `- not run: kill ${entry.index + 1} (${entry.moment}): ${entry.errors.join('; ')}`,
    ),
  ].join('\n');
}
const seats_ = (ms: number | null) => (ms === null ? 'never' : seconds(ms));
