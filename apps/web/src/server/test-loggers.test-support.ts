import type { Logger } from '@daisy/logger';

type RecordedLog = { event: string; message: string; fields: unknown };

/** A logger that discards everything, for handlers whose logs are not under test. */
export const silentLogger: Logger = {
  log: () => {},
  child: () => silentLogger,
};

/**
 * A logger that records every call with its bound child fields, so tests of
 * `handleOperation`-based handlers can assert on emitted events. Returns the
 * live `recorded` array (clear it between assertions with
 * `recorded.length = 0`).
 */
export function createRecordingLogger() {
  const recorded: RecordedLog[] = [];
  const createRecorder = (
    boundFields: Record<string, unknown> = {},
  ): Logger => ({
    log: (event, fields, message) =>
      recorded.push({ event, fields: { ...boundFields, ...fields }, message }),
    child: (fields) => createRecorder({ ...boundFields, ...fields }),
  });
  return { recorded, logger: createRecorder() };
}
