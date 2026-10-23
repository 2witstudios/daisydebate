import type {
  APIRequestContext,
  BrowserContext,
  Page,
  Response,
} from '@playwright/test';
import {
  attendanceReceiptSchema,
  attendanceTimingPolicy,
  type AttendanceReceipt,
} from '@daisy/protocol';
import { expect, openPage } from './fixtures';
import { readBallotRound, ballotRoundCommand } from './human-ballot-round';
import { attendanceEvidence } from './attendance-evidence';
import { observeAttendanceSockets } from './attendance-socket';

export async function closeAttendedFixture(
  request: APIRequestContext,
  roundId: string,
  participantId: string,
) {
  const current = await readBallotRound(request, roundId);
  await ballotRoundCommand(request, current, {
    type: 'forfeit',
    participantId,
  });
}

export async function healthyAttendance(roundId: string) {
  await expect
    .poll(
      async () =>
        (await attendanceEvidence(roundId)).samples
          .slice(-3)
          .map((sample) => sample.healthy),
      { timeout: 15_000 },
    )
    .toEqual([true, true, true]);
}

export async function pastOriginalAttendanceGrace(
  roundId: string,
  startedAt: string,
) {
  await expect
    .poll(
      async () =>
        Date.parse((await attendanceEvidence(roundId)).observedAt) -
        Date.parse(startedAt),
      { timeout: 50_000, intervals: [500] },
    )
    .toBeGreaterThan(45_000);
}

/**
 * After an outage ends, the whole grace can still remain (an outage that began
 * at the opening), then the finalization buffer, the public probe's recovery
 * and a maintenance tick. A fixed 50 s left under 3 s of that margin.
 */
const resolutionWaitMs =
  attendanceTimingPolicy.graceMs +
  attendanceTimingPolicy.finalizationBufferMs +
  15_000;

export async function attendedResolution(roundId: string, segmentId: string) {
  await expect
    .poll(
      async () =>
        (await attendanceEvidence(roundId)).adjudications.find(
          (row) => row.segmentId === segmentId,
        )?.decision,
      { timeout: resolutionWaitMs, intervals: [500] },
    )
    .toBe('attended');
}

export const receiptResponse = (roundId: string) => (response: Response) =>
  new URL(response.url()).pathname === `/api/rounds/${roundId}/check-in` &&
  response.request().method() === 'POST' &&
  response.status() === 200;
export const receiptFrom = async (
  response: Response,
): Promise<AttendanceReceipt> =>
  attendanceReceiptSchema.parse(await response.json());
export async function actualSpeech(
  request: APIRequestContext,
  roundId: string,
) {
  let actual:
    Awaited<ReturnType<typeof readBallotRound>>['segments'][number] | undefined;
  await expect
    .poll(
      async () => {
        actual = (await readBallotRound(request, roundId)).segments.find(
          (segment) => segment.type === 'speech' && segment.endedAt === null,
        );
        return actual?.id ?? null;
      },
      { timeout: 10_000 },
    )
    .toEqual(expect.any(String));
  if (!actual) throw new Error('Actual speech opening missing');
  return actual;
}
export async function enterSpeech(
  context: BrowserContext,
  roundId: string,
  label: string,
) {
  const page = await openPage(context, label);
  const connections = observeAttendanceSockets(page);
  const response = page.waitForResponse(receiptResponse(roundId));
  await page.goto(`/rounds/${roundId}/room`);
  return { page, connections, receipt: await receiptFrom(await response) };
}
export async function nextReceipt(
  page: Page,
  roundId: string,
  action: () => Promise<unknown>,
) {
  const pending = page.waitForResponse(receiptResponse(roundId));
  await action();
  return receiptFrom(await pending);
}
