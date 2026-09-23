import pino from 'pino';

export const eventRegistry = {
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
const stripEvent = (fields: LogFields): LogFields => {
  const safeFields = { ...fields };
  Reflect.deleteProperty(safeFields, 'event');
  return safeFields;
};
export function createLogger({
  service,
  level = 'info',
  appVersion = 'development',
  gitCommit = 'unknown',
  destination,
}: {
  service: string;
  level?: string;
  appVersion?: string;
  gitCommit?: string;
  destination?: { write: (text: string) => void };
}): Logger {
  const options = {
    level,
    base: { service, appVersion, gitCommit },
    redact: {
      paths: [
        'password',
        'token',
        'secret',
        'authorization',
        'cookie',
        'DATABASE_URL',
        'REDIS_URL',
        '*.password',
        '*.token',
        '*.secret',
        '*.authorization',
        '*.cookie',
        'headers.authorization',
        'headers.cookie',
      ],
      censor: '[REDACTED]',
    },
  };
  const instance = destination ? pino(options, destination) : pino(options);
  const wrap = (logger: pino.Logger): Logger => ({
    log: (event, fields, message) => {
      const normalizedEvent = normalizeEvent(event);
      logger[eventRegistry[normalizedEvent]](
        { ...stripEvent(fields), event: normalizedEvent },
        message,
      );
    },
    child: (fields) => wrap(logger.child(stripEvent(fields))),
  });
  return wrap(instance);
}
