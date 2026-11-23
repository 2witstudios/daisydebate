import { roomCastChoiceSchema } from '@daisy/protocol/room-read';
import type { RoomCastChoice } from '@daisy/protocol/room-contract';
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
  const debater = bots.find((bot) => bot.aiRole === 'debater');
  const aiJudge = bots.find((bot) => bot.aiRole === 'judge');
  expect([Boolean(debater), Boolean(aiJudge)]).toEqual([true, true]);
  return { debater: debater!, aiJudge: aiJudge! };
}

/**
 * The eligible AI judge alone. The AI judge is not behind the bot-debates
 * release (ADR 0921), so a member without it is still offered one.
 */
export function aiJudgeIn(bots: readonly RoomCastChoice[]) {
  const aiJudge = bots.find((bot) => bot.eligible && bot.aiRole === 'judge');
  expect(aiJudge).toBeDefined();
  return aiJudge!;
}
