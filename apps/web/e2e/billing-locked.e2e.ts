import { test, expect } from './support/fixtures';
import { signUpMember, origin } from './support/accounts';
import { readRoomBotRoster } from './support/ai-cast';
import { reread } from './support/room-launch-flow';
import { systemId } from '@daisy/clock';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
// Controlled grant-loss setup; this does not attest a genuine Stripe lapse.
const withdraw = async (name: 'ai-judge' | 'capture', user: string) => {
  await promisify(execFile)(
    'bun',
    [
      fileURLToPath(
        new URL(
          './support/withdraw-casual-' + name + '-process.ts',
          import.meta.url,
        ),
      ),
      user,
    ],
    { timeout: 20000, maxBuffer: 4096 },
  );
};
test.use({ javaScriptEnabled: false });
test('locked features keep native withdrawal and lead by keyboard to honest member usage', async ({
  page,
}, info) => {
  const { username } = await signUpMember(page.request);
  await withdraw('ai-judge', username);
  const roster = await readRoomBotRoster(page.request),
    opponent = roster.find(
      (b) => b.label === 'Wren' && b.seatRole === 'debater',
    ),
    judge = roster.find((b) => b.seatRole === 'judge');
  expect(opponent?.eligible).toBe(true);
  expect(judge).toBeDefined();
  await page.goto('/train?bot=' + opponent!.actorId);
  await page
    .getByRole('button', { name: 'Start practice', exact: true })
    .click();
  await expect(page).toHaveURL(/\/rooms\/[a-z0-9]{24}$/);
  const roomId = new URL(page.url()).pathname.split('/').at(-1)!;
  await page.getByRole('link', { name: 'Room setup', exact: true }).click();
  await page
    .getByRole('checkbox', { name: 'Record this round', exact: true })
    .check();
  await page
    .getByRole('button', { name: 'Save broadcast and recording', exact: true })
    .click();
  expect((await reread(page.request, roomId)).capture?.recording).toBe(true);
  await withdraw('capture', username);
  await page.goto('/rooms/' + roomId);
  const view = await reread(page.request, roomId);
  expect(view.aiJudgeSeating).toBe('premium');
  expect(view.captureOffer).toBe('premium');
  const judgeNotice = page
    .getByRole('status')
    .filter({ hasText: 'Invite a person to judge instead' });
  const captureNotice = page
    .getByRole('status')
    .filter({
      hasText:
        'Broadcasting and recording a casual round come with a subscription.',
    });
  const judgeLink = judgeNotice.getByRole('link', {
    name: 'Explore Premium',
    exact: true,
  });
  await expect(judgeLink).toBeVisible();
  await expect(judgeLink).toHaveAttribute('href', '/premium');
  const admission = view.botAdmission;
  if (!admission || admission.kind === 'unavailable')
    throw Error('Expected current bot allowance quote');
  await expect(
    page.getByRole('status').filter({ hasText: 'bot debates remaining' }),
  ).toContainText(
    `${admission.remaining} of ${admission.limit} bot debates remaining`,
  );
  const forged = await page.request.post('/api/rooms/' + roomId + '/commands', {
    headers: { origin },
    data: {
      type: 'assign-seat',
      commandId: systemId.next(),
      expectedVersion: view.version,
      actorId: judge!.actorId,
      role: 'judge',
      slot: 0,
    },
  });
  expect(forged.status()).toBe(409);
  expect((await forged.json()).refusal).toBe('ai-judge-premium');
  expect((await reread(page.request, roomId)).version).toBe(view.version);
  await page.getByRole('link', { name: 'Room setup', exact: true }).click();
  await expect(
    captureNotice.getByRole('link', { name: 'Explore Premium', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', {
      name: 'Turn off broadcast and recording',
      exact: true,
    })
    .click();
  expect((await reread(page.request, roomId)).capture).toBeNull();
  await expect(
    page.getByRole('button', {
      name: 'Turn off broadcast and recording',
      exact: true,
    }),
  ).toHaveCount(0);
  await page.goto('/rooms/' + roomId);
  await judgeLink.focus();
  await judgeLink.press('Enter');
  await expect(page).toHaveURL('/premium');
  await page.getByRole('link', { name: 'Billing', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Billing', exact: true }),
  ).toBeVisible();
  const settings = await (
    await page.request.get('/api/billing/settings')
  ).json();
  expect(settings.plan).toBe('free');
  expect(settings.botDebates.kind).toBe('limited');
  expect(settings.botDebates.remaining).toBe(admission.remaining);
  expect(settings.botDebates.limit).toBe(admission.limit);
  await expect(
    page
      .locator('p')
      .filter({
        hasText: `${admission.remaining} of ${admission.limit} debates remaining`,
      }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath('native-member-usage-after-locked-feature.png'),
    fullPage: true,
  });
});
