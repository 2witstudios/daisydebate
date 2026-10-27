import {
  eventRegistry,
  fieldKinds,
  loggableFields,
  type EventName,
} from './vocabulary';

/**
 * Admission of one shipped log line (ADR 0084): the store keeps only what
 * this logger could have written, judged by the same registry and field
 * kinds the logger writes with, so the two cannot drift.
 */
type Severity = (typeof eventRegistry)[EventName];
export type AdmittedEntry = {
  readonly at: string;
  readonly event: EventName;
  readonly severity: Severity;
  readonly service: string;
  readonly appVersion: string;
  readonly gitCommit: string;
  readonly fields: Readonly<Record<string, string | number>>;
};
export type DropReason = 'json' | 'event' | 'level' | 'base' | 'field';
export type Admission =
  | { readonly ok: true; readonly entry: AdmittedEntry }
  | { readonly ok: false; readonly reason: DropReason };

/** pino's numeric level for each registry severity. */
const pinoLevels = { info: 30, warn: 40, error: 50 } as const;
/** pino's own envelope keys: read (`level`, `time`) or dropped unread. */
const envelopeKeys = new Set(['level', 'time', 'pid', 'hostname', 'msg']);
const baseKeys = new Set(['service', 'appVersion', 'gitCommit', 'event']);
const baseValue = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(value);
/** Far above any line the logger writes; larger input is never parsed. */
const MAX_LINE = 8_192;

const drop = (reason: DropReason): Admission => ({ ok: false, reason });
const isEvent = (value: unknown): value is EventName =>
  typeof value === 'string' && Object.hasOwn(eventRegistry, value);

/** The line as a plain JSON object, or null. */
const parseObject = (line: string): Record<string, unknown> | null => {
  if (line.length > MAX_LINE) return null;
  try {
    const parsed: unknown = JSON.parse(line);
    return parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

const validBase = ({
  time,
  service,
  appVersion,
  gitCommit,
}: Record<string, unknown>) =>
  Number.isSafeInteger(time) &&
  (time as number) >= 0 &&
  [service, appVersion, gitCommit].every(baseValue);

/** Every non-envelope key as a loggable field of its kind, or null. */
const admitFields = (
  record: Record<string, unknown>,
): Record<string, string | number> | null => {
  const fields: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(record)) {
    if (envelopeKeys.has(name) || baseKeys.has(name)) continue;
    const kind = Object.hasOwn(loggableFields, name)
      ? loggableFields[name as keyof typeof loggableFields]
      : undefined;
    if (kind === undefined || !fieldKinds[kind](value)) return null;
    fields[name] = value as string | number;
  }
  return fields;
};

export function admitLogLine(line: string): Admission {
  const record = parseObject(line);
  if (!record) return drop('json');
  if (!isEvent(record.event)) return drop('event');
  const severity = eventRegistry[record.event];
  if (record.level !== pinoLevels[severity]) return drop('level');
  if (!validBase(record)) return drop('base');
  const fields = admitFields(record);
  if (!fields) return drop('field');
  return {
    ok: true,
    entry: {
      at: new Date(record.time as number).toISOString(),
      event: record.event,
      severity,
      service: record.service as string,
      appVersion: record.appVersion as string,
      gitCommit: record.gitCommit as string,
      fields,
    },
  };
}
