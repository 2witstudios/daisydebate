import type {
  APIRequestContext,
  Browser,
  Locator,
  Page,
} from '@playwright/test';
import { createId } from '@paralleldrive/cuid2';
import {
  attendanceReceiptSchema,
  isNamedSeat,
  roundBallotReadSchema,
} from '@daisy/protocol';
import { expect, openPage } from './fixtures';
import { hydrated } from './hydration';
import { origin } from './accounts';
import { createRoomLaunchAccounts } from './room-launch-accounts';
import {
  createHumanBallotRound,
  readBallotRound,
  ballotRoundCommand,
} from './human-ballot-round';

const readBallot = async (request: APIRequestContext, roundId: string) => {
  const response = await request.get(`/api/rounds/${roundId}/ballots`);
  expect(response.status()).toBe(200);
  return roundBallotReadSchema.parse(await response.json());
};

/** Actual first-speech check-ins and legal yields through both speeches. */
export async function playActualSpeeches(
  members: Awaited<ReturnType<typeof createRoomLaunchAccounts>>['members'],
  judgeSeats: 0 | 2 = 2,
) {
  const host = members[0]!.context;
  let view = await createHumanBallotRound(members, judgeSeats);
  for (const [sequence, role] of (
    ['affirmative', 'negative'] as const
  ).entries()) {
    await expect(async () => {
      view = await readBallotRound(host.request, view.id);
      expect(
        view.segments.find((s) => s.endedAt === null && s.type === 'speech')
          ?.sequence,
      ).toBe(sequence);
    }).toPass({ timeout: 20_000 });
    const open = view.segments.find(
      (s) => s.endedAt === null && s.type === 'speech',
    )!;
    if (sequence === 0) {
      for (const member of members.slice(0, 2)) {
        const receipt = await member.context.request.post(
          `/api/rounds/${view.id}/check-in`,
          {
            headers: { origin },
            data: { version: 1, commandId: createId(), segmentId: open.id },
          },
        );
        expect(receipt.status()).toBe(200);
        const stamp = attendanceReceiptSchema.parse(await receipt.json());
        expect([stamp.roundId, stamp.segmentId]).toEqual([view.id, open.id]);
      }
    }
    const seat = view.participants
      .filter(isNamedSeat)
      .find((p) => p.role === role)!;
    view = await ballotRoundCommand(members[sequence]!.context.request, view, {
      type: 'yield',
      participantId: seat.id,
    });
  }
  return view;
}

/** The hydrated server action answers in place: one fetch, no document POST. */
async function submitEnhanced(page: Page, submit: Locator) {
  await hydrated(submit);
  const documents: string[] = [];
  page.on('request', (request) => {
    if (request.isNavigationRequest()) documents.push(request.method());
  });
  const action = page.waitForRequest(
    (request) =>
      request.method() === 'POST' &&
      request.resourceType() === 'fetch' &&
      'next-action' in request.headers(),
  );
  await submit.click();
  await action;
  await expect(
    page.getByText('Ballot submitted.', { exact: false }),
  ).toBeVisible();
  expect(documents).toEqual([]);
}

/** No fixture clock, maintenance callback, seeded ledger, transcript or ballot. */
export async function proveHumanJudgedJourney(browser: Browser) {
  const accounts = await createRoomLaunchAccounts(browser, 4);
  let native: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  try {
    const host = accounts.members[0]!.context;
    const view = await playActualSpeeches(accounts.members);
    const last = view.segments.at(-1)!;
    expect(last.endedAt).not.toBeNull();
    const judge = accounts.members[2]!.context;
    let input = await readBallot(judge.request, view.id);
    expect(input.freeze).toBeNull();
    await expect(async () => {
      input = await readBallot(judge.request, view.id);
      expect(input.freeze).not.toBeNull();
    }).toPass({ timeout: 160_000 });
    expect(Date.parse(input.freeze!.frozenAt)).toBeGreaterThanOrEqual(
      Date.parse(last.endedAt!) + 120_000,
    );
    for (const index of [2, 3]) {
      let context = accounts.members[index]!.context;
      if (index === 2) {
        native = await browser.newContext({
          baseURL: origin,
          ignoreHTTPSErrors: true,
          javaScriptEnabled: false,
          storageState: await context.storageState(),
        });
        context = native;
      }
      const page = await openPage(
        context,
        index === 2 ? 'native actual judge' : 'enhanced actual final judge',
      );
      await page.goto(`/judge/ballot/${view.id}`);
      await page
        .locator('label')
        .filter({
          has: page.locator('input[name="winner"][value="affirmative"]'),
        })
        .click();
      await page
        .getByLabel('Reason for decision')
        .fill(
          'The affirmative carried the decisive comparison in this test Round.',
        );
      const submit = page.getByRole('button', {
        name: 'Submit ballot',
        exact: true,
      });
      if (index === 2) await submit.click();
      else await submitEnhanced(page, submit);
      await expect(
        page.getByText('Ballot submitted.', { exact: false }),
      ).toBeVisible();
      const own = await readBallot(context.request, view.id);
      expect(own.own?.status).toBe('submitted');
      expect(own.own?.freezeRevision).toBe(input.freeze!.revision);
      const other = await readBallot(
        accounts.members[1]!.context.request,
        view.id,
      );
      expect(other.own).toBeNull();
      expect(other.freeze).toBeNull();
      expect(other.ballots).toHaveLength(index === 2 ? 0 : 2);
      for (const hidden of accounts.members.slice(2))
        expect(JSON.stringify(other)).not.toContain(hidden.username);
    }
    const completed = await readBallotRound(host.request, view.id);
    expect([completed.status, completed.outcome]).toEqual([
      'completed',
      'affirmative',
    ]);
  } finally {
    await native?.close();
    await accounts.closeContexts();
  }
}
