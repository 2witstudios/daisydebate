import { instantMs } from '@daisy/clock';
import {
  affirmativeSide,
  sideOfSeat,
  twoSideKeys,
  type SideKey,
} from '@daisy/protocol/seats';
import { TRANSCRIPT_ADMISSION_WINDOW_MS } from '@daisy/protocol/capture-timing';
import { winnerOutcome } from '@daisy/protocol/round-outcome';
import type {
  APIRequestContext,
  Browser,
  Locator,
  Page,
} from '@playwright/test';
import { createId } from '@paralleldrive/cuid2';
import { attendanceReceiptSchema } from '@daisy/protocol/attendance';
import { isNamedSeat, type RoundView } from '@daisy/protocol/round-view';
import { roundBallotReadSchema } from '@daisy/protocol/round-ballot-read';
import { expect, openPage } from './fixtures';
import { hydrated } from './hydration';
import { origin } from './accounts';
import { createRoomLaunchAccounts } from './room-launch-accounts';
import {
  createHumanBallotRound,
  readBallotRound,
  ballotRoundCommand,
  openSequence,
} from './human-ballot-round';

const readBallot = async (request: APIRequestContext, roundId: string) => {
  const response = await request.get(`/api/rounds/${roundId}/ballots`);
  expect(response.status()).toBe(200);
  return roundBallotReadSchema.parse(await response.json());
};

type Members = Awaited<ReturnType<typeof createRoomLaunchAccounts>>['members'];
/** The actual open speech `sequence`, read by `request` until it opens. */
export async function openSpeech(
  request: APIRequestContext,
  view: RoundView,
  sequence: number,
  timeout = 20_000,
) {
  await expect(async () => {
    view = await readBallotRound(request, view.id);
    expect(
      view.segments.find((s) => s.endedAt === null && s.type === 'speech')
        ?.sequence,
    ).toBe(sequence);
  }).toPass({ timeout });
  const open = view.segments.find(
    (s) => s.endedAt === null && s.type === 'speech',
  )!;
  return { view, open };
}
/** One member's own public-route check-in for `segmentId`. */
export async function checkIn(
  member: Members[number],
  view: RoundView,
  segmentId: string,
) {
  const receipt = await member.context.request.post(
    `/api/rounds/${view.id}/check-in`,
    {
      headers: { origin },
      data: { version: 1, commandId: createId(), segmentId },
    },
  );
  expect(receipt.status()).toBe(200);
  const stamp = attendanceReceiptSchema.parse(await receipt.json());
  expect([stamp.roundId, stamp.segmentId]).toEqual([view.id, segmentId]);
}
/** The member's legal yield of their own seat on `side`. */
export function yieldSpeech(
  member: Members[number],
  view: RoundView,
  side: SideKey,
) {
  const seat = view.participants
    .filter(isNamedSeat)
    .find((p) => sideOfSeat(p.seat) === side)!;
  return ballotRoundCommand(member.context.request, view, {
    type: 'yield',
    participantId: seat.id,
    sequence: openSequence(view),
  });
}

/** Actual first-speech check-ins and legal yields through both speeches. */
export async function playActualSpeeches(
  members: Members,
  judgeSeats: 0 | 2 = 2,
) {
  let view = await createHumanBallotRound(members, judgeSeats);
  for (const [sequence, side] of twoSideKeys.entries()) {
    const opened = await openSpeech(
      members[0]!.context.request,
      view,
      sequence,
    );
    view = opened.view;
    if (sequence === 0)
      for (const member of members.slice(0, 2))
        await checkIn(member, view, opened.open.id);
    view = await yieldSpeech(members[sequence]!, view, side);
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
    expect(instantMs(input.freeze!.frozenAt)).toBeGreaterThanOrEqual(
      instantMs(last.endedAt!) + TRANSCRIPT_ADMISSION_WINDOW_MS,
    );
    for (const index of [2, 3]) {
      const context = accounts.members[index]!.context;
      const page = await openPage(
        context,
        index === 2 ? 'actual judge' : 'actual final judge',
      );
      await page.goto(`/judge/ballot/${view.id}`);
      await page
        .locator('label')
        .filter({
          has: page.locator(`input[name="winner"][value="${affirmativeSide}"]`),
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
      await submitEnhanced(page, submit);
      await expect(
        page.getByText('Ballot submitted.', { exact: false }),
      ).toBeVisible();
      const own = await readBallot(context.request, view.id);
      expect(own.own?.ballot).toBeTruthy();
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
      winnerOutcome(affirmativeSide),
    ]);
  } finally {
    await accounts.closeContexts();
  }
}
