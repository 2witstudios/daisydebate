import { expect } from '@playwright/test';

type Boundary = {
  readonly since: number;
  readonly requestIds: readonly string[];
  readonly operation: string;
};

/** Private correlation from actual response headers, never an emitted identity. */
export function completedMessagingOperations(
  source: string,
  boundary: Boundary,
) {
  const lines: Record<string, unknown>[] = source
    .split('\n')
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Record<string, unknown>];
      } catch {
        return [];
      }
    });
  return lines
    .filter(
      (line) =>
        boundary.requestIds.includes(String(line['requestId'])) &&
        line['operation'] === boundary.operation &&
        ['http.request.completed', 'http.request.failed'].includes(
          String(line['event']),
        ) &&
        typeof line['time'] === 'number' &&
        typeof line['durationMs'] === 'number' &&
        line['time'] - line['durationMs'] >= boundary.since,
    )
    .map((line) => ({
      requestId: String(line['requestId']),
      status: line['status'],
      errorCode: line['errorCode'],
      admission:
        lines.find(
          (summary) =>
            summary['event'] === 'db.capacity.refused' &&
            summary['requestId'] === line['requestId'] &&
            summary['operation'] === boundary.operation &&
            typeof summary['time'] === 'number' &&
            summary['time'] >=
              Math.max(
                boundary.since,
                Number(line['time']) - Number(line['durationMs']),
              ) &&
            summary['time'] <= Number(line['time']),
        )?.['cause'] ?? null,
    }));
}

/** Await log I/O only; success and every error status settle this precondition. */
export async function awaitMessagingOperations(
  read: () => Promise<string>,
  boundary: Boundary,
) {
  let records: ReturnType<typeof completedMessagingOperations> = [];
  await expect
    .poll(async () => {
      records = completedMessagingOperations(await read(), boundary);
      return {
        count: records.length,
        correspondingResponses: new Set(
          records.map((record) => record.requestId),
        ).size,
      };
    })
    .toEqual({
      count: boundary.requestIds.length,
      correspondingResponses: boundary.requestIds.length,
    });
  return records;
}
