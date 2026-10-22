import { z } from 'zod';
import {
  attendanceReceiptSchema,
  attendanceTimingPolicy,
  roundViewSchema,
} from '@daisy/protocol';

const closedWindow = z.object({
  refusal: z.enum([
    'attendance-finalized',
    'attendance-terminal',
    'attendance-window-closed',
  ]),
});
/** Normal authenticated HTTP, independent of socket/resource-view delivery. */
export function createAttendanceHttpClient(input: {
  readonly roundId: string;
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  readonly timeout: (ms: number) => AbortSignal;
}) {
  const options = () => ({
    credentials: 'same-origin' as const,
    redirect: 'error' as const,
    signal: input.timeout(attendanceTimingPolicy.commitBudgetMs),
  });
  return {
    async read() {
      const response = await input.fetch(`/api/rounds/${input.roundId}`, {
        ...options(),
        cache: 'no-store',
      });
      if (!response.ok) return null;
      const parsed = roundViewSchema.safeParse(await response.json());
      return parsed.success && parsed.data.id === input.roundId
        ? parsed.data
        : null;
    },
    async send(command: {
      readonly commandId: string;
      readonly segmentId: string;
    }) {
      const response = await input.fetch(
        `/api/rounds/${input.roundId}/check-in`,
        {
          ...options(),
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ version: 1, ...command }),
        },
      );
      const body: unknown = await response.json().catch(() => null);
      if (response.status === 409 && closedWindow.safeParse(body).success)
        return 'closed' as const;
      if (!response.ok) return false;
      const parsed = attendanceReceiptSchema.safeParse(body);
      return (
        parsed.success &&
        parsed.data.commandId === command.commandId &&
        parsed.data.segmentId === command.segmentId &&
        parsed.data.roundId === input.roundId
      );
    },
  };
}
