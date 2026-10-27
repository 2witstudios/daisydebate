import { z } from 'zod';
import { securityViews, type SecurityView } from './sections';

/**
 * The Security page's URL state (no client script): the view and the time
 * window. Anything outside the closed sets falls back, never echoed. The
 * longest window stays inside the store's 28-day TTL.
 */
export const securityWindows = ['1h', '24h', '7d', '28d'] as const;
export type SecurityWindow = (typeof securityWindows)[number];
const windowMs: Readonly<Record<SecurityWindow, number>> = {
  '1h': 3_600_000,
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
  '28d': 28 * 86_400_000,
};

const one = (value: unknown) => (typeof value === 'string' ? value : undefined);
const viewSchema = z.enum(securityViews).catch('auth');
const windowSchema = z.enum(securityWindows).catch('24h');

export function securityQuery(params: Readonly<Record<string, unknown>>): {
  readonly view: SecurityView;
  readonly window: SecurityWindow;
} {
  return {
    view: viewSchema.parse(one(params.view)),
    window: windowSchema.parse(one(params.window)),
  };
}

export const securityHref = (state: {
  readonly view: SecurityView;
  readonly window: SecurityWindow;
}) => `/security?${new URLSearchParams(state).toString()}`;

/** DateTime64(3) bind-parameter text for an ISO instant. */
const chTime = (ms: number) =>
  new Date(ms).toISOString().replace('T', ' ').replace('Z', '');
/** ClickHouse's text for a DateTime64 or DateTime value, as epoch ms. */
const fromChTime = (text: string) =>
  Date.parse(`${text.replace(' ', 'T')}${text.length > 19 ? '' : '.000'}Z`);

export function windowBounds(
  now: string,
  window: SecurityWindow,
): { readonly from: string; readonly to: string } {
  const to = Date.parse(now);
  return { from: chTime(to - windowMs[window]), to: chTime(to) };
}

/** The coverage reads look back one day, and the flow check one hour. */
export const coverageBounds = (now: string) => ({
  floor: chTime(Date.parse(now) - windowMs['24h']),
  recent: chTime(Date.parse(now) - windowMs['1h']),
});

/** A heartbeat older than this means the counts below may be incomplete. */
const HEARTBEAT_STALE_MS = 3 * 60_000;
/** Past this age a stored row breaks the retention lifecycle (DEC-42: 30). */
const RETENTION_ALARM_MS = 29 * 86_400_000;

/** The sweep runs hourly; two missed runs mean retention is not enforced. */
const SWEEP_STALE_MS = 2 * 3_600_000;

export type Coverage = {
  readonly shipper: 'live' | 'degraded' | 'stale' | 'missing';
  readonly natsState: string | null;
  readonly reconnects: number | null;
  /** Apps whose refused lines (other than non-JSON output) in the last hour are at least their stored ones. */
  readonly refusing: readonly string[];
  readonly retention: 'ok' | 'overdue' | 'unswept';
};

type Heartbeat = {
  readonly at: string;
  readonly nats_state: string;
  readonly reconnects: string | number;
};
type Flow = {
  readonly app: string;
  readonly admitted: string | number;
  readonly dropped: string | number;
};

const shipperState = (nowMs: number, heartbeat: Heartbeat | null) =>
  !heartbeat
    ? 'missing'
    : nowMs - fromChTime(heartbeat.at) > HEARTBEAT_STALE_MS ||
        heartbeat.nats_state !== 'connected'
      ? 'stale'
      : 'live';

const retentionState = (
  nowMs: number,
  oldest: readonly { readonly oldest: string }[],
  lastSweep: string | null,
) => {
  // An empty table reports the epoch as its minimum.
  const overdue = oldest.some(({ oldest: text }) => {
    const ms = fromChTime(text);
    return ms > 0 && nowMs - ms > RETENTION_ALARM_MS;
  });
  if (overdue) return 'overdue';
  const swept = lastSweep === null ? 0 : fromChTime(lastSweep);
  return swept > 0 && nowMs - swept <= SWEEP_STALE_MS ? 'ok' : 'unswept';
};

/**
 * Whether the counts can be trusted as coverage: a recent heartbeat from a
 * connected shipper that is storing what it receives, no stored row past
 * the retention alarm, and a recent partition sweep. Zero events never
 * reads as healthy on its own: a shipper refusing everything is degraded.
 */
export function coverageOf({
  now,
  heartbeat,
  flow,
  oldest,
  lastSweep,
}: {
  readonly now: string;
  readonly heartbeat: Heartbeat | null;
  readonly flow: readonly Flow[];
  readonly oldest: readonly { readonly oldest: string }[];
  readonly lastSweep: string | null;
}): Coverage {
  const nowMs = Date.parse(now);
  const refusing = flow
    .filter(
      ({ admitted, dropped }) =>
        Number(dropped) > 0 && Number(dropped) >= Number(admitted),
    )
    .map(({ app }) => app);
  const state = shipperState(nowMs, heartbeat);
  return {
    shipper: state === 'live' && refusing.length > 0 ? 'degraded' : state,
    natsState: heartbeat?.nats_state ?? null,
    reconnects: heartbeat ? Number(heartbeat.reconnects) : null,
    refusing,
    retention: retentionState(nowMs, oldest, lastSweep),
  };
}
