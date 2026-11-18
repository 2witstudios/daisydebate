import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { systemClock } from '@daisy/clock';
import { createId } from '@paralleldrive/cuid2';
import { assertNoSeriousFindings } from './support/axe';
import { origin, signUpMember, youthBirth } from './support/accounts';
import { expect, openPage, test } from './support/fixtures';

/**
 * YLS-7 (ADR 0155) in a real browser: a youth debater's school coach finds
 * their student's live Youth Round under Watch's "Your students, live" and
 * watches it as timing, transcript and read-only floor chat, with no media
 * and nothing to post; the student's Room link takes them there too, with
 * JavaScript on and off, and a stranger finds nothing.
 */
const seed = async (input: Record<string, unknown>): Promise<unknown> => {
  const { stdout } = await promisify(execFile)(
    'bun',
    [
      resolve(import.meta.dirname, 'support/broadcast-seed-process.ts'),
      JSON.stringify(input),
    ],
    {
      cwd: resolve(import.meta.dirname, '../../..'),
      env: process.env,
      timeout: 60_000,
    },
  );
  return JSON.parse(stdout);
};

const seeded: string[] = [];

test.afterEach(async () => {
  await Promise.all(
    seeded.splice(0).map((roundId) => seed({ command: 'stop', roundId })),
  );
});

test("a coach watches their student's live Youth Round, and a stranger cannot", async ({
  page,
  context,
  browser,
}) => {
  const student = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
  });
  const { username: studentName } = await signUpMember(
    student.request,
    youthBirth(systemClock.now()),
  );
  await student.close();
  const { username: coachName } = await signUpMember(context.request);
  const tag = createId().slice(0, 8);
  const round = (await seed({
    command: 'create',
    mode: 'ranked',
    visibility: 'public',
    division: 'youth',
    affUsername: studentName,
    title: `Thursday scrimmage ${tag}`,
    resolution: `Cities should ban cars ${tag}`,
  })) as { roundId: string; roomId: string; caption: string };
  seeded.push(round.roundId);
  await seed({
    command: 'link-coach',
    coachUsername: coachName,
    studentUsername: studentName,
  });

  // Watch: the coach's own section, never the public listing.
  await page.goto('/watch');
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
  await expect(page.getByText(round.caption)).toBeVisible();
  await expect(page.getByText('This Round chat is read-only.')).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.locator('video')).toHaveCount(0);
  await assertNoSeriousFindings(page);

  // The student's Room and Round links lead to the same room, with JavaScript
  // and without.
  await page.goto(`/rooms/${round.roomId}`);
  await expect(page).toHaveURL(`/rounds/${round.roundId}/room`);
  await page.goto(`/rounds/${round.roundId}`);
  await expect(page).toHaveURL(`/rounds/${round.roundId}/room`);
  const noScript = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
    javaScriptEnabled: false,
    storageState: await context.storageState(),
  });
  try {
    const plain = await noScript.newPage();
    await plain.goto(`/rooms/${round.roomId}`);
    await expect(plain).toHaveURL(`/rounds/${round.roundId}/room`);
    await expect(plain.getByText('Watching', { exact: true })).toBeVisible();
    await expect(plain.getByText(round.caption)).toBeVisible();
  } finally {
    await noScript.close();
  }

  // A stranger who is a member finds no section and no room.
  const strangerContext = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
  });
  try {
    await signUpMember(strangerContext.request);
    const stranger = await openPage(strangerContext, 'member');
    await stranger.goto('/watch');
    await expect(
      stranger.getByRole('heading', { name: 'Watch', level: 1 }),
    ).toBeVisible();
    await expect(stranger.getByText('Your students, live')).toHaveCount(0);
    await expect(stranger.getByText(`Thursday scrimmage ${tag}`)).toHaveCount(
      0,
    );
    const response = await stranger.goto(`/rounds/${round.roundId}/room`);
    expect(response?.status()).toBe(404);
  } finally {
    await strangerContext.close();
  }
});
