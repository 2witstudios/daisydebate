import { loggableFields } from '@daisy/logger';
import type { AdmittedEntry } from '@daisy/logger/ingest';
import type { FlyLogRecord } from './envelope';

/** A loggable field's `daisy_logs.events` column: its snake_case name. */
export const columnOf = (field: string): string =>
  field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

/** DateTime64(3, 'UTC') text, which JSONEachRow parses as UTC. */
export const clickHouseTime = (instant: string) =>
  instant.replace('T', ' ').replace('Z', '');

export type EventRow = Readonly<Record<string, string | number | null>>;

/**
 * The `daisy_logs.events` row for one admitted line: the shipper's receipt
 * time (which retention runs on), the source time, the envelope's
 * placement, the logger's base fields, and one column per loggable field,
 * null where the line did not carry it.
 */
export function toEventRow(
  record: FlyLogRecord,
  entry: AdmittedEntry,
  receivedAt: string,
): EventRow {
  const row: Record<string, string | number | null> = {
    received_at: clickHouseTime(receivedAt),
    ts: clickHouseTime(entry.at),
    app: record.app,
    region: record.region,
    instance: record.instance,
    service: entry.service,
    app_version: entry.appVersion,
    git_commit: entry.gitCommit,
    event: entry.event,
    severity: entry.severity,
  };
  for (const field of Object.keys(loggableFields))
    row[columnOf(field)] = entry.fields[field] ?? null;
  return row;
}
