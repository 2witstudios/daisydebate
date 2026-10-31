import { roomCastChoiceSchema } from '@daisy/protocol';
import type { RoomCastChoice } from '@daisy/protocol';
import type { APIRequestContext } from '@playwright/test';
import type { Page } from '@playwright/test';
import { expect } from './fixtures';

/** The real roster from the authenticated Room catalog endpoint. */
export async function readRoomBotRoster(
  request: APIRequestContext,
): Promise<readonly RoomCastChoice[]> {
  const response = await request.get('/api/rooms/catalog');
  expect(response.status()).toBe(200);
  const catalog = (await response.json()) as { bots: readonly unknown[] };
  return catalog.bots.map((bot) => roomCastChoiceSchema.parse(bot));
}

/** Select one roster actor on Train and create the ordinary Room it names. */
export async function startTrainPractice(
  page: Page,
  actorId: string,
  name: string,
): Promise<string> {
  await page.goto(`/train?bot=${actorId}`);
  await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
  await page.getByRole('button', { name: 'Start practice' }).click();
  await expect(page).toHaveURL(/\/rooms\/[a-z0-9]{24}$/);
  return new URL(page.url()).pathname.split('/').at(-1)!;
}

/**
 * The eligible bot debater and AI judge from a Room catalog body: a bot
 * debater takes a side and the AI judge the judge seat (ISSUE-750).
 */
export function aiCast(catalog: { readonly bots: readonly unknown[] }) {
  const bots = catalog.bots
    .map((bot) => roomCastChoiceSchema.parse(bot))
    .filter((bot) => bot.eligible);
  const debater = bots.find((bot) => bot.seatRole === 'debater');
  const aiJudge = bots.find((bot) => bot.seatRole === 'judge');
  expect([Boolean(debater), Boolean(aiJudge)]).toEqual([true, true]);
  return { debater: debater!, aiJudge: aiJudge! };
}
