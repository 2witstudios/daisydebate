import type {
  APIRequestContext,
  BrowserContext,
  Page,
  Request,
  Response,
} from '@playwright/test';
import {
  attendanceReceiptSchema,
  attendanceTimingPolicy,
  type AttendanceReceipt,
} from '@daisy/protocol';
import { MAINTENANCE_PULSE_MS } from '../../src/features/round-finalization/service';
import { expect, openPage } from './fixtures';
import { currentRoundForfeit, readBallotRound } from './human-ballot-round';
import { attendanceEvidence } from './attendance-evidence';
import { observeAttendanceSockets } from './attendance-socket';

export async function closeAttendedFixture(
  request: APIRequestContext,
  roundId: string,
  participantId: string,
) {
  await currentRoundForfeit(request, roundId, participantId);
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
 * at the opening), then the finalization buffer, the public probe's next
 * heartbeat and a maintenance pulse. A fixed 50 s left under 3 s of that margin.
 */
const resolutionWaitMs =
  attendanceTimingPolicy.graceMs +
  attendanceTimingPolicy.finalizationBufferMs +
  attendanceTimingPolicy.heartbeatMs +
  MAINTENANCE_PULSE_MS;

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
/**
 * The first receipt the page requests once `action` starts, never one the
 * previous document asked for. Its body is read as it arrives: a reload
 * navigates away from a response, and Chromium then drops its body.
 */
export async function nextReceipt(
  page: Page,
  roundId: string,
  action: () => Promise<unknown>,
) {
  const requested = new Set<Request>();
  const track = (request: Request) => requested.add(request);
  let body: unknown;
  const pending = page.waitForResponse(async (response) => {
    if (
      !receiptResponse(roundId)(response) ||
      !requested.has(response.request())
    )
      return false;
    body = await response.json();
    return true;
  });
  page.on('request', track);
  try {
    await action();
    await pending;
  } finally {
    page.off('request', track);
  }
  return attendanceReceiptSchema.parse(body);
}
