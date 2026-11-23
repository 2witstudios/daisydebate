import { createId } from '@paralleldrive/cuid2';
import { negativeSide, sideSeat } from '@daisy/protocol/seats';
import { expect, openPage, test } from './support/fixtures';
import { readRoomBotRoster } from './support/ai-cast';
import {
  origin,
  resetRateLimits,
  signUpBotDebater,
  signUpMember,
} from './support/accounts';

/**
 * Bot debates are a release (ADR 0921). An ordinary member reads Coming soon
 * where bot debates had an entry and the server refuses a direct request;
 * the operator override opens them for one account and nobody else.
 */
test.beforeEach(async ({ request }) => {
  await resetRateLimits(request);
});

test('an ordinary member reads Coming soon on Train and Play, and a direct practice request is refused', async ({
  page,
  browser,
}) => {
  // A released account reads the real roster so the forged post names a
  // real bot debater; the ordinary member is never offered one.
  const released = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
  });
  let botId: string;
  try {
    await signUpBotDebater(released.request);
    const debater = (await readRoomBotRoster(released.request)).find(
      (bot) => bot.aiRole === 'debater',
    );
    if (!debater) throw new Error('The e2e roster holds no bot debater');
    botId = debater.actorId;
  } finally {
    await released.close();
  }

  await signUpMember(page.request);
  await page.goto('/train');
  await expect(
    page.getByText('Bot debates are coming soon.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Start practice' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('region', { name: 'Choose an opponent' }),
  ).toHaveCount(0);

  await page.goto('/play');
  const choices = page.getByRole('list', { name: 'Ways to play' });
  await expect(
    choices.getByText('Coming soon.', { exact: true }),
  ).toBeVisible();
  await expect(choices.locator('a[href^="/train"]')).toHaveCount(0);

  // The roster offers no bot debater, and the post Start practice would send
  // is refused by the server whatever the page showed.
  const roster = await readRoomBotRoster(page.request);
  expect(roster.some((bot) => bot.aiRole === 'debater')).toBe(false);
  const refused = await page.request.post('/api/rooms', {
    headers: { origin },
    data: {
      commandId: createId(),
      title: 'Practice vs a bot',
      resolution: { kind: 'strike' },
      visibility: 'public',
      selection: {
        kind: 'catalog',
        formatId: 'freestyle',
        formatVersion: 1,
        presetVersion: 1,
        competitionType: 'casual',
      },
      sides: 'open',
      practice: true,
      cast: [{ actorId: botId, seat: sideSeat(negativeSide) }],
    },
  });
  expect(refused.status()).toBe(409);
  expect(((await refused.json()) as { refusal?: string }).refusal).toBe(
    'bot-debates-coming-soon',
  );
});

test('the operator override opens Train for its own account only', async ({
  browser,
}) => {
  const released = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
  });
  const ordinary = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
  });
  try {
    await signUpBotDebater(released.request);
    await signUpMember(ordinary.request);
    const open = await openPage(released, 'Released Train');
    await open.goto('/train');
    await expect(
      open.getByRole('region', { name: 'Choose an opponent' }),
    ).toBeVisible();
    const closed = await openPage(ordinary, 'Ordinary Train');
    await closed.goto('/train');
    await expect(
      closed.getByText('Bot debates are coming soon.', { exact: true }),
    ).toBeVisible();
  } finally {
    await released.close();
    await ordinary.close();
  }
});
