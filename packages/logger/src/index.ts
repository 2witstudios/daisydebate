import pino from 'pino';

const eventRegistry = {
  'runtime.initialize': 'info',
  'request.unhandled': 'error',
  'http.request.completed': 'info',
  'http.request.cancelled': 'warn',
  'http.request.failed': 'error',
  'invariant.violated': 'error',
  'auth.rate_limit.denied': 'warn',
  'auth.rate_limit.unavailable': 'error',
  'auth.session.unavailable': 'error',
  'auth.mail.sent': 'info',
  'auth.mail.failed': 'error',
  'auth.mail.receipt_failed': 'error',
  'auth.cleanup.completed': 'info',
  'auth.cleanup.failed': 'error',
  'auth.magic_link.verified': 'info',
  'auth.passkey.enrolled': 'info',
  'auth.passkey.authenticated': 'info',
  'auth.passkey.removed': 'info',
  'auth.session.revoked': 'info',
  'auth.session.revoked_all': 'info',
  'auth.email_change.requested': 'info',
  'auth.email_change.verified': 'info',
  'auth.email_change.cleanup_failed': 'error',
  'realtime.cleanup.completed': 'info',
  'realtime.cleanup.failed': 'error',
  'realtime.outbox.append_failed': 'error',
  'realtime.outbox.actor_missing': 'warn',
  'realtime.connection.rejected': 'info',
  'db.query.failed': 'error',
  'redis.command.failed': 'error',
  'server.start': 'info',
  'server.shutdown': 'info',
  'telemetry.unknown_event': 'warn',
} as const satisfies Record<string, 'info' | 'warn' | 'error'>;

export type EventName = keyof typeof eventRegistry;
export type LogFields = Readonly<Record<string, unknown>> & {
  readonly event?: never;
};
// Mirrors packages/config's LOG_LEVEL enum. Logger cannot depend on
// @daisy/config (declared dependencies: pino only), so the literal union is
// kept in sync here rather than imported.
export type LogLevel =
  | 'fatal'
  | 'error'
  | 'warn'
  | 'info'
  | 'debug'
  | 'trace'
  | 'silent';
export type Logger = {
  log: (event: EventName, fields: LogFields, message: string) => void;
  child: (fields: LogFields) => Logger;
};
const eventNames = new Set<EventName>(
  Object.keys(eventRegistry) as EventName[],
);
const normalizeEvent = (event: string): EventName =>
  eventNames.has(event as EventName)
    ? (event as EventName)
    : 'telemetry.unknown_event';

// Any key whose normalized (lowercased, letters-only) form contains one of
// these substrings is redacted, at every depth: this is an allowlist-by-
// exclusion over the whole fields tree, not a fixed list of top-level or
// one-level paths, so a secret nested under `err`, `cause`, or any other
// wrapper is caught too. Covers every config secret name (BETTER_AUTH_SECRET,
// RESEND_API_KEY, RESEND_WEBHOOK_SECRET, DATABASE_URL, REDIS_URL), the
// protocol's `ticket` bearer, `set-cookie`, and the generic password/token/
// secret/cookie/authorization shapes.
const REDACTED_KEY_SUBSTRINGS = [
  'password',
  'token',
  'ticket',
  'secret',
  'cookie',
  'authorization',
  'apikey',
  'databaseurl',
  'redisurl',
] as const;
const isRedactedKey = (key: string): boolean => {
  const normalized = key.toLowerCase().replace(/[^a-z]/g, '');
  return REDACTED_KEY_SUBSTRINGS.some((needle) =>
    normalized.includes(needle),
  );
};
const CENSOR = '[REDACTED]';
// Query parameters that carry a bearer credential when a field's string
// value is a URL (magic-link and email-change confirmation links).
const REDACTED_URL_PARAMS = ['token', 'ticket', 'code', 'secret'];
const redactUrlValue = (value: string): string => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return value;
  }
  let redacted = false;
  for (const param of REDACTED_URL_PARAMS)
    if (url.searchParams.has(param)) {
      url.searchParams.set(param, CENSOR);
      redacted = true;
    }
  return redacted ? url.toString() : value;
};
// Recursively redacts every key matching `isRedactedKey` and every string
// leaf that is a URL carrying a bearer query parameter, at unbounded depth.
// `seen` guards against a circular `cause` chain on a thrown Error.
const deepRedact = (value: unknown, seen: WeakSet<object>): unknown => {
  if (typeof value === 'string') return redactUrlValue(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return CENSOR;
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => deepRedact(item, seen));
  if (value instanceof Error)
    return {
      name: value.name,
      message: redactUrlValue(value.message),
      ...(value.cause !== undefined
        ? { cause: deepRedact(value.cause, seen) }
        : {}),
    };
  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [
      key,
      isRedactedKey(key) ? CENSOR : deepRedact(entryValue, seen),
    ]),
  );
};
const sanitize = (fields: LogFields): LogFields => {
  const safeFields = { ...fields };
  Reflect.deleteProperty(safeFields, 'event');
  return deepRedact(safeFields, new WeakSet()) as LogFields;
};
export function createLogger({
  service,
  level = 'info',
  appVersion = 'development',
  gitCommit = 'unknown',
  destination,
}: {
  service: string;
  level?: LogLevel;
  appVersion?: string;
  gitCommit?: string;
  destination?: { write: (text: string) => void };
}): Logger {
  const options = {
    level,
    base: { service, appVersion, gitCommit },
  };
  const instance = destination ? pino(options, destination) : pino(options);
  const wrap = (logger: pino.Logger): Logger => ({
    log: (event, fields, message) => {
      const normalizedEvent = normalizeEvent(event);
      logger[eventRegistry[normalizedEvent]](
        { ...sanitize(fields), event: normalizedEvent },
        message,
      );
    },
    child: (fields) => wrap(logger.child(sanitize(fields))),
  });
  return wrap(instance);
}
