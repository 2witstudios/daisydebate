import type {
  APIRequestContext,
  BrowserContext,
  Page,
  Response,
} from '@playwright/test';
import {
  attendanceReceiptSchema,
  type AttendanceReceipt,
} from '@daisy/protocol';
import { expect, openPage } from './fixtures';
import { readBallotRound } from './human-ballot-round';

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
  const response = page.waitForResponse(receiptResponse(roundId));
  await page.goto(`/rounds/${roundId}/room`);
  return { page, receipt: await receiptFrom(await response) };
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
