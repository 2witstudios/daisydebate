import type {
  Frame,
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
/** A browser whose first reconcile fails leaves the vendor room, so the answer is what keeps it seated. */
const mediaReconcileResponse = (roundId: string) => (response: Response) =>
  new URL(response.url()).pathname ===
    `/api/rounds/${roundId}/media/reconcile` && response.status() === 200;
export const receiptFrom = async (
  response: Response,
): Promise<AttendanceReceipt> =>
  attendanceReceiptSchema.parse(await response.json());
export async function actualSpeech(
  request: APIRequestContext,
  roundId: string,
  timeoutMs = 10_000,
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
      { timeout: timeoutMs },
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
  const mediaSettled = page
    .waitForResponse(mediaReconcileResponse(roundId))
    .then(() => undefined);
  // A caller that never asks leaves this wait unawaited; only the asking matters.
  mediaSettled.catch(() => undefined);
  await page.goto(`/rounds/${roundId}/room`);
  return {
    page,
    connections,
    mediaSettled,
    receipt: await receiptFrom(await response),
  };
}
/** The first receipt requested once `watch` starts counting. Its body is read as it arrives. */
async function firstReceipt(
  page: Page,
  roundId: string,
  action: () => Promise<unknown>,
  watch: (track: (request: Request) => void) => () => void,
) {
  const requested = new Set<Request>();
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
  // A failed action leaves this wait unawaited; report only that failure.
  pending.catch(() => undefined);
  const stop = watch((request) => requested.add(request));
  try {
    await action();
    await pending;
  } finally {
    stop();
  }
  return attendanceReceiptSchema.parse(body);
}
/** The first receipt this page requests once `action` starts; it must not navigate. */
export const nextReceipt = (
  page: Page,
  roundId: string,
  action: () => Promise<unknown>,
) =>
  firstReceipt(page, roundId, action, (track) => {
    page.on('request', track);
    return () => page.off('request', track);
  });
/**
 * The new document's first receipt after a reload. Counting starts when the
 * main frame commits: the old document can still send one, whose body is either
 * discarded by the navigation or a replay that proves nothing about this page.
 */
export const receiptAfterReload = (page: Page, roundId: string) =>
  firstReceipt(
    page,
    roundId,
    () => page.reload(),
    (track) => {
      const committed = (frame: Frame) => {
        if (frame !== page.mainFrame()) return;
        page.off('framenavigated', committed);
        page.on('request', track);
      };
      page.on('framenavigated', committed);
      return () => {
        page.off('framenavigated', committed);
        page.off('request', track);
      };
    },
  );
