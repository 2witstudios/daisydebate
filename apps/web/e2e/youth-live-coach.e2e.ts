import { createId } from '@paralleldrive/cuid2';
import { assertNoSeriousFindings } from './support/axe';
import { origin, signUpMember } from './support/accounts';
import { expect, openPage, test } from './support/fixtures';
import {
  coachedYouthRound,
  openFloor,
  postFloorMessage,
} from './support/youth-coach';

/**
 * YLS-7, YLS-12 and YLS-19 (ADR 0155, 0158, 0161) in a real browser: a youth
 * debater's school coach finds their student's live private Youth Round under
 * Watch's "Your students, live" and watches it through the Room's privacy as
 * timing, transcript and read-only floor chat (the student's message there
 * included), with no media and nothing to post; the Round link takes them
 * there too, and a stranger finds nothing, as on
 * any private Round. The floor message arriving live
 * through realtime is proven in the messaging realtime cohort
 * (`support/youth-coach-floor-live.ts`).
 */
const cleanups: Array<() => Promise<unknown>> = [];

test.afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

test('Watch shows a private student tournament Round to the linked adult without a standing selection', async ({
  page,
  context,
  browser,
}) => {
  const { student, tag, round, stop } = await coachedYouthRound(
    browser,
    context,
    { tournament: true },
  );
  cleanups.push(stop, () => student.close());
  const link = `/watch?lobby=${createId()}`;
  const title = `Thursday scrimmage ${tag}`;
  await page.goto(link);
  const roomLink = page
    .getByRole('region', { name: 'Your students, live' })
    .getByRole('link', { name: `Watch ${title}` });
  const roomPath = `/rounds/${round.roundId}/room`;
  await expect(roomLink).toHaveAttribute('href', roomPath);
  await roomLink.click();
  await expect(page).toHaveURL(roomPath);
  await expect(page.getByText('Watching', { exact: true })).toBeVisible();
  const strangerContext = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
  });
  try {
    await signUpMember(strangerContext.request);
    const stranger = await openPage(strangerContext, 'unlinked member');
    await stranger.goto(link);
    await expect(
      stranger.getByRole('heading', { name: 'Watch', level: 1 }),
    ).toBeVisible();
    await expect(stranger.getByText(title, { exact: true })).toHaveCount(0);
    const response = await stranger.goto(roomPath);
    expect(response?.status()).toBe(404);
  } finally {
    await strangerContext.close();
  }
});

test("a coach watches their student's private live Youth Round, and a stranger cannot", async ({
  page,
  context,
  browser,
}) => {
  const { student, studentName, tag, round, stop } = await coachedYouthRound(
    browser,
    context,
  );
  cleanups.push(stop, () => student.close());
  // The student says something on the floor before the coach arrives.
  const channelId = await openFloor(student.request, round.roundId);
  const said = `Watch the second contention ${tag}`;
  expect(
    await postFloorMessage(student.request, round.roundId, channelId, said),
  ).toMatchObject({ status: 200 });

  // Watch: the coach's own section, never the public listing.
  await page.goto('/watch');
  await page
    .getByRole('navigation', { name: 'Lobby', exact: true })
    .getByRole('link', { name: 'Youth', exact: true })
    .click();
  const students = page.getByRole('region', { name: 'Your students, live' });
  await expect(students).toContainText(`Thursday scrimmage ${tag}`);
  await expect(students).toContainText(`Cities should ban cars ${tag}`);
  await expect(students).toContainText(studentName);
  await students
    .getByRole('link', { name: `Watch Thursday scrimmage ${tag}` })
    .click();

  await expect(page).toHaveURL(`/rounds/${round.roundId}/room`);
  await expect(page.getByText('Watching', { exact: true })).toBeVisible();
  await expect(page.getByText('hosting')).toHaveCount(0);
  await expect(page.getByText(`Cities should ban cars ${tag}`)).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Debaters' }).getByText(studentName),
  ).toBeVisible();
  // The transcript, undelayed; and the floor chat, read only.
  const transcript = page.getByRole('region', { name: 'Transcript' });
  await transcript.getByText('Show the transcript').click();
  await expect(transcript.getByText(round.caption)).toBeVisible();
  const floor = page.getByRole('region', { name: 'Round floor chat' });
  await expect(floor.getByText('This Round chat is read-only.')).toBeVisible();
  // Its composer is locked: nothing to type, nothing to send.
  await expect(page.getByRole('textbox')).toHaveCount(1);
  await expect(floor.getByRole('textbox')).not.toBeEditable();
  await expect(
    floor.getByRole('button', { name: 'Send message' }),
  ).toBeDisabled();
  await expect(page.locator('video')).toHaveCount(0);
  await expect(
    floor
      .getByRole('list', { name: 'Floor messages' })
      .getByText(said, { exact: true }),
  ).toBeVisible();
  // The coach reads and never posts (DEC-174, decision 84).
  expect(
    await postFloorMessage(
      context.request,
      round.roundId,
      channelId,
      'A coach’s word in',
    ),
  ).toEqual({ status: 403, code: 'AUTHORIZATION' });
  await assertNoSeriousFindings(page);

  // The Round link leads to the same room. (The
  // Room link's answer, `live_room`, is proven on a real Room in
  // youth-live-audience.integration.ts: these seeded rows carry no Room
  // configuration a Room page could read.)
  await page.goto(`/rounds/${round.roundId}`);
  await expect(page).toHaveURL(`/rounds/${round.roundId}/room`);

  // A stranger who is a member finds no section and no room.
  const strangerContext = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
  });
  try {
    await signUpMember(strangerContext.request);
    const stranger = await openPage(strangerContext, 'member');
    await stranger.goto('/watch');
    await stranger
      .getByRole('navigation', { name: 'Lobby', exact: true })
      .getByRole('link', { name: 'Youth', exact: true })
      .click();
    await expect(
      stranger.getByRole('heading', { name: 'Watch', level: 1 }),
    ).toBeVisible();
    await expect(stranger.getByText('Your students, live')).toHaveCount(0);
    await expect(stranger.getByText(`Thursday scrimmage ${tag}`)).toHaveCount(
      0,
    );
    const response = await stranger.goto(`/rounds/${round.roundId}/room`);
    expect(response?.status()).toBe(404);
    await stranger.goto(`/watch/${round.roundId}`);
    await expect(
      stranger.getByText('This debate is not available'),
    ).toBeVisible();
  } finally {
    await strangerContext.close();
  }
});
