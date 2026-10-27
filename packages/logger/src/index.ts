import pino from 'pino';
import {
  eventRegistry,
  fieldKinds,
  loggableFields,
  type EventName,
} from './vocabulary';

export { eventRegistry, loggableFields, type EventName };

export type LogFields = Readonly<Record<string, unknown>> & {
  readonly event?: never;
};
// Mirrors packages/config's LOG_LEVEL enum. The logger's only runtime
// dependency is pino (@daisy/config is a test-only devDependency, for the
// redaction tests' secret keys), so the literal union is kept in sync here
// rather than imported.
export type LogLevel =
  'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
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

const CENSOR = '[REDACTED]';
/**
 * Fixed prose: short words of letters and light punctuation, with no digit,
 * URL, assignment or long run a credential would need.
 */
const isProse = (message: string) =>
  /^[A-Za-z][A-Za-z ,.;'()_-]{0,159}$/.test(message) &&
  message.split(/[ ,;()]+/).every((word) => word.length <= 24);

/**
 * Reads only the allowlisted names, as own data properties, so no getter
 * runs and no nested value is walked: a deep, circular, shared or hostile
 * structure costs one lookup per listed name and can never throw.
 */
const admit = (fields: unknown): Record<string, string | number> => {
  const admitted: Record<string, string | number> = {};
  if (fields === null || typeof fields !== 'object') return admitted;
  for (const [name, kind] of Object.entries(loggableFields)) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(fields, name);
    } catch {
      continue;
    }
    const value: unknown = descriptor?.value;
    if (fieldKinds[kind](value)) admitted[name] = value as string | number;
  }
  return admitted;
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
  const options = { level, base: { service, appVersion, gitCommit } };
  const instance = destination ? pino(options, destination) : pino(options);
  const wrap = (logger: pino.Logger): Logger => ({
    log: (event, fields, message) => {
      const normalizedEvent = normalizeEvent(event);
      logger[eventRegistry[normalizedEvent]](
        { ...admit(fields), event: normalizedEvent },
        typeof message === 'string' && isProse(message) ? message : CENSOR,
      );
    },
    child: (fields) => wrap(logger.child(admit(fields))),
  });
  return wrap(instance);
}
