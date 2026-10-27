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

/** The coverage reads look back one day. */
export const coverageFloor = (now: string) =>
  chTime(Date.parse(now) - windowMs['24h']);

/** A heartbeat older than this means the counts below may be incomplete. */
const HEARTBEAT_STALE_MS = 3 * 60_000;
/** Past this age a stored row breaks the retention lifecycle (DEC-42: 30). */
const RETENTION_ALARM_MS = 29 * 86_400_000;

export type Coverage = {
  readonly shipper: 'live' | 'stale' | 'missing';
  readonly natsState: string | null;
  readonly reconnects: number | null;
  readonly retention: 'ok' | 'overdue';
};

/**
 * Whether the counts can be trusted as coverage: a recent heartbeat from a
 * connected shipper, and no stored row past the retention alarm. Zero
 * events never reads as healthy on its own.
 */
export function coverageOf({
  now,
  heartbeat,
  oldest,
}: {
  readonly now: string;
  readonly heartbeat: {
    readonly at: string;
    readonly nats_state: string;
    readonly reconnects: string | number;
  } | null;
  readonly oldest: readonly { readonly oldest: string }[];
}): Coverage {
  const nowMs = Date.parse(now);
  const shipper = !heartbeat
    ? 'missing'
    : nowMs - fromChTime(heartbeat.at) > HEARTBEAT_STALE_MS ||
        heartbeat.nats_state !== 'connected'
      ? 'stale'
      : 'live';
  // An empty table reports the epoch as its minimum.
  const overdue = oldest.some(({ oldest: text }) => {
    const ms = fromChTime(text);
    return ms > 0 && nowMs - ms > RETENTION_ALARM_MS;
  });
  return {
    shipper,
    natsState: heartbeat?.nats_state ?? null,
    reconnects: heartbeat ? Number(heartbeat.reconnects) : null,
    retention: overdue ? 'overdue' : 'ok',
  };
}
