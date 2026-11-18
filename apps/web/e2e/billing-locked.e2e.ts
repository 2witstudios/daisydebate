import { judgeSeat } from '@daisy/protocol';
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
test('locked features show the upgrade panel in place, keep native withdrawal and never count', async ({
  page,
}, info) => {
  const { username } = await signUpMember(page.request);
  await withdraw('ai-judge', username);
  const roster = await readRoomBotRoster(page.request),
    opponent = roster.find((b) => b.label === 'Wren' && b.aiRole === 'debater'),
    judge = roster.find((b) => b.aiRole === 'judge');
  expect(opponent?.eligible).toBe(true);
  expect(judge).toBeDefined();
  await page.goto('/train?bot=' + opponent!.actorId);
  await page
    .getByRole('button', { name: 'Start practice', exact: true })
    .click();
  await expect(page).toHaveURL(/\/rooms\/[a-z0-9]{24}$/);
  const roomId = new URL(page.url()).pathname.split('/').at(-1)!;
  await page.getByRole('link', { name: 'Edit settings', exact: true }).click();
  await page
    .getByRole('checkbox', { name: 'Record this round', exact: true })
    .check();
  await page
    .getByRole('button', { name: 'Save broadcast and recording', exact: true })
    .click();
  expect((await reread(page.request, roomId)).capture?.recordingPolicy).toBe(
    'released',
  );
  await withdraw('capture', username);
  await page.goto('/rooms/' + roomId);
  const view = await reread(page.request, roomId);
  expect(view.aiJudgeSeating).toBe('not-included');
  expect(view.captureOffer).toBe('premium');
  const judgeNotice = page
    .getByRole('status')
    .filter({ hasText: 'AI judging on casual Rounds is Premium' });
  const captureNotice = page
    .getByRole('status')
    .filter({ hasText: 'Recording and broadcast are Premium' });
  const judgeLink = judgeNotice.getByRole('link', {
    name: 'Get Premium',
    exact: true,
  });
  await expect(judgeLink).toBeVisible();
  await expect(judgeLink).toHaveAttribute('href', '/premium');
  await expect(
    judgeNotice.getByRole('button', { name: 'Invite a judge', exact: true }),
  ).toBeVisible();
  const admission = view.botAdmission;
  if (!admission || admission.kind === 'unavailable')
    throw Error('Expected current bot admission decision');
  // PYL-10: the Room carries only the decision, and the page shows no count.
  expect(Object.keys(admission).sort()).toEqual(['kind', 'refusal']);
  await expect(page.getByText(/remaining|Explore Premium/)).toHaveCount(0);
  const forged = await page.request.post('/api/rooms/' + roomId + '/commands', {
    headers: { origin },
    data: {
      type: 'assign-seat',
      commandId: systemId.next(),
      expectedVersion: view.version,
      actorId: judge!.actorId,
      seat: judgeSeat(),
    },
  });
  expect(forged.status()).toBe(409);
  expect((await forged.json()).refusal).toBe('ai-judge-premium');
  expect((await reread(page.request, roomId)).version).toBe(view.version);
  await page.getByRole('link', { name: 'Edit settings', exact: true }).click();
  await expect(
    captureNotice.getByRole('link', { name: 'Get Premium', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('switch', { name: 'Record this round', exact: true }),
  ).toBeDisabled();
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
  // A beta member holds Premium by grant (ADR 0146): nothing to buy, no counter.
  expect(settings.plan).toBe('granted');
  expect(settings).not.toHaveProperty('botDebates');
  await expect(page.getByText(/remaining|Bot debates/)).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath('billing-without-counters-after-locked-feature.png'),
    fullPage: true,
  });
});
