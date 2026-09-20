import pino from 'pino';

export type EventName =
  | 'runtime.initialize'
  | 'request.unhandled'
  | 'http.request'
  | 'server.start'
  | 'server.shutdown'
  | 'telemetry.unknown_event';
export type LogFields = Readonly<Record<string, unknown>>;
export type Logger = {
  info: (event: EventName, fields: LogFields, message: string) => void;
  warn: (event: EventName, fields: LogFields, message: string) => void;
  error: (event: EventName, fields: LogFields, message: string) => void;
  child: (fields: LogFields) => Logger;
};
const eventNames = new Set<EventName>([
  'runtime.initialize',
  'request.unhandled',
  'http.request',
  'server.start',
  'server.shutdown',
  'telemetry.unknown_event',
]);
const normalizeEvent = (event: string): EventName =>
  eventNames.has(event as EventName)
    ? (event as EventName)
    : 'telemetry.unknown_event';
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
    info: (event, fields, message) =>
      logger.info({ ...fields, event: normalizeEvent(event) }, message),
    warn: (event, fields, message) =>
      logger.warn({ ...fields, event: normalizeEvent(event) }, message),
    error: (event, fields, message) =>
      logger.error({ ...fields, event: normalizeEvent(event) }, message),
    child: (fields) => wrap(logger.child(fields)),
  });
  return wrap(instance);
}
