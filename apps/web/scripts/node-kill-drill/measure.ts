/** Pure measures for the node kill drill: every number in its report comes from here. */
export type Interval = { readonly start: number; readonly end: number };

/** Nearest rank. An unrecovered sample (null) ranks above every number. */
export function percentile(
  samples: readonly (number | null)[],
  rank: number,
): number | null {
  if (!samples.length) return null;
  const ordered = [...samples].sort(
    (a, b) => (a ?? Infinity) - (b ?? Infinity),
  );
  return ordered[Math.ceil((rank / 100) * ordered.length) - 1] ?? null;
}

const HOLD_READS = 2;

/**
 * From a seat's timed health reads: when it first faltered, when it first held
 * healthy for two reads, and how often it fell away again.
 */
export function seatRecovery(
  reads: readonly { readonly atMs: number; readonly ready: boolean }[],
  killMs: number,
) {
  const afterKill = reads.filter((read) => read.atMs >= killMs);
  const firstLost = afterKill.find((read) => !read.ready);
  if (!firstLost) return { lostMs: null, backMs: null, relapses: 0 };
  let streak = 0;
  let streakStart = 0;
  let backAt: number | null = null;
  let relapses = 0;
  let healthy = false;
  for (const read of afterKill.slice(afterKill.indexOf(firstLost))) {
    if (read.ready) {
      if (streak === 0) streakStart = read.atMs;
      streak++;
      healthy = true;
      if (streak >= HOLD_READS && backAt === null) backAt = streakStart;
    } else {
      if (healthy) relapses++;
      streak = 0;
      healthy = false;
    }
  }
  return {
    lostMs: firstLost.atMs - killMs,
    backMs: backAt === null ? null : backAt - killMs,
    relapses,
  };
}

/** What capture owed a stream: its grants, within the segment's speaking time and the past. */
export function owedBy(
  grants: readonly { readonly start: number; readonly end: number | null }[],
  segment: {
    readonly startMs: number;
    readonly endMs: number | null;
    readonly durationMs: number;
  },
  nowMs: number,
): readonly Interval[] {
  const speakingEnd = Math.min(
    segment.endMs ?? Infinity,
    segment.startMs + segment.durationMs,
    nowMs,
  );
  return grants
    .map((grant) => ({
      start: Math.max(grant.start, segment.startMs),
      end: Math.min(grant.end ?? Infinity, speakingEnd),
    }))
    .filter((grant) => grant.end > grant.start);
}

const merged = (intervals: readonly Interval[]) => {
  const ordered = [...intervals].sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const next of ordered) {
    const last = out.at(-1);
    if (last && next.start <= last.end)
      out[out.length - 1] = {
        start: last.start,
        end: Math.max(last.end, next.end),
      };
    else out.push(next);
  }
  return out;
};
const lengthOf = (intervals: readonly Interval[]) =>
  intervals.reduce((total, next) => total + next.end - next.start, 0);
const intersect = (a: readonly Interval[], b: readonly Interval[]) =>
  a.flatMap((left) =>
    b.flatMap((right) => {
      const start = Math.max(left.start, right.start);
      const end = Math.min(left.end, right.end);
      return end > start ? [{ start, end }] : [];
    }),
  );

/**
 * Observed speech over owed speech, overall and with the outage set aside: the
 * owner's target is 100 percent outside an incident. Nothing owed is no number.
 */
export function captureCoverage(
  owedIntervals: readonly Interval[],
  observedIntervals: readonly Interval[],
  outage: Interval | null,
) {
  const owed = merged(owedIntervals);
  const observed = intersect(owed, merged(observedIntervals));
  const owedMs = lengthOf(owed);
  const observedMs = lengthOf(observed);
  const owedInOutage = outage ? lengthOf(intersect(owed, [outage])) : 0;
  const observedInOutage = outage ? lengthOf(intersect(observed, [outage])) : 0;
  const owedOutside = owedMs - owedInOutage;
  const observedOutside = observedMs - observedInOutage;
  return {
    owedMs,
    observedMs,
    missingMs: owedMs - observedMs,
    coverage: owedMs ? observedMs / owedMs : null,
    missingOutsideOutageMs: owedOutside - observedOutside,
    coverageOutsideOutage: owedOutside ? observedOutside / owedOutside : null,
  };
}

/** From the kill to the first audio observed that began after it. */
export function captureBackAfter(
  observed: readonly Interval[],
  killMs: number,
): number | null {
  const after = observed
    .filter((window) => window.start >= killMs)
    .map((window) => window.start);
  return after.length ? Math.min(...after) - killMs : null;
}

const HOUR_MS = 3_600_000;

/** Incidents per 1,000 Round-hours; no table or no Round time is no rate. */
export function incidentRate(
  incidents: number | null,
  roundMs: number,
): number | null {
  if (incidents === null || roundMs <= 0) return null;
  return (incidents / (roundMs / HOUR_MS)) * 1000;
}

/** Reads `fly machine list --json` or `docker inspect` state output. */
export const isNodeUp = (output: string) =>
  /"state":\s*"started"/.test(output) || /^running$/m.test(output);

export type SeatRead = {
  readonly connected: boolean;
  readonly peerCamera: boolean;
  readonly peerAudio: boolean;
  readonly inboundVideoBytes: number;
  readonly inboundAudioBytes: number;
};

/**
 * Healthy means media is arriving now: a frozen last frame still has a width
 * and a ready state, so a seat counts only while its received bytes are rising.
 */
export const seatIsHealthy = (
  previous: SeatRead | null,
  read: SeatRead,
  owedPeerAudio: boolean,
) => {
  if (!previous || !read.connected || !read.peerCamera) return false;
  if (read.inboundVideoBytes <= previous.inboundVideoBytes) return false;
  if (!owedPeerAudio) return true;
  return read.peerAudio && read.inboundAudioBytes > previous.inboundAudioBytes;
};

export type IceTransport = {
  readonly protocol: string;
  readonly address: string;
  readonly port: number;
  readonly candidateType: string;
};

const carries = (media: string, transport: IceTransport) =>
  media === transport.address ||
  media === `${transport.address}:${transport.port}`;

/** Which configured node a seat's selected ICE pairs reach; one node needs no reading. */
export function nodeCarrying<T extends { readonly media: string }>(
  nodes: readonly T[],
  transports: readonly IceTransport[],
): T | null {
  if (nodes.length === 1) return nodes[0]!;
  const found = nodes.filter((node) =>
    transports.some((transport) => carries(node.media, transport)),
  );
  return found.length === 1 ? found[0]! : null;
}

/** Direct UDP: not TCP, and not a relay. */
export const isDirectUdp = (transports: readonly IceTransport[]) =>
  transports.length > 0 &&
  transports.every(
    (transport) =>
      transport.protocol === 'udp' && transport.candidateType !== 'relay',
  );
