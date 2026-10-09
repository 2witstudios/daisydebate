import type { APIRequestContext, Page } from '@playwright/test';
import {
  roomCastChoiceSchema,
  roomViewSchema,
  type RoomView,
} from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import { expect } from './fixtures';
import { origin } from './accounts';
export const reread = async (request: APIRequestContext, id: string) => {
  const response = await request.get(`/api/rooms/${id}`);
  expect(response.status()).toBe(200);
  return roomViewSchema.parse(await response.json());
};
export const deniedCommand = (
  request: APIRequestContext,
  view: RoomView,
  body: object,
) =>
  request.post(`/api/rooms/${view.id}/commands`, {
    headers: { origin },
    data: { ...body, commandId: createId(), expectedVersion: view.version },
  });
export async function createFromPlay(
  page: Page,
  title: string,
  formatId = 'foundation',
) {
  await page.goto('/play');
  await page.getByRole('link', { name: /^Open a practice room\b/ }).click();
  const form = page.getByRole('form', { name: 'Create a room' });
  const templates = form.getByLabel('Format template');
  const values = await templates
    .locator('option')
    .evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value),
    );
  const selected = values.find(
    (value) => JSON.parse(value).formatId === formatId,
  );
  if (!selected) throw new Error('Required actual format template is missing');
  await templates.selectOption(selected);
  await form.getByLabel('Room name', { exact: true }).fill(title);
  await form
    .getByLabel('Debate topic')
    .fill('Proof cities should fund transit');
  await form.getByLabel('Who can find the room').selectOption('public');
  await form.getByRole('button', { name: 'Create room', exact: true }).click();
  await expect(page).toHaveURL(/\/rooms\/[a-z0-9]+$/);
  const id = new URL(page.url()).pathname.split('/').at(-1)!;
  return reread(page.request, id);
}
export async function claim(page: Page, view: RoomView, seat: string) {
  await page.goto(`/rooms/${view.id}`);
  await page.getByRole('button', { name: `Take ${seat}`, exact: true }).click();
  const [role, number] = seat.toLowerCase().split(' ');
  await expect(async () => {
    view = await reread(page.request, view.id);
    expect(
      view.participants.some(
        (participant) =>
          participant.kind === 'human' &&
          participant.role === role &&
          participant.slot === Number(number) - 1,
      ),
    ).toBe(true);
  }).toPass({ timeout: 10_000 });
  return view;
}

/** Real actors from the authenticated catalog; human judge claims its own seat. */
export async function prepareJudgeRoom(page: Page, title: string) {
  let view = await createFromPlay(page, title, 'one-on-one');
  const response = await page.request.get('/api/rooms/catalog');
  expect(response.status()).toBe(200);
  const body = await response.json();
  const bots = body.bots.map((bot: unknown) => roomCastChoiceSchema.parse(bot));
  const eligible = bots.filter(
    (bot: ReturnType<typeof roomCastChoiceSchema.parse>) => bot.eligible,
  );
  expect(eligible.length).toBeGreaterThanOrEqual(2);
  for (const [index, seat] of ['Affirmative 1', 'Negative 1'].entries()) {
    const select = page.getByLabel(`Assign ${seat}`, { exact: true });
    await select.selectOption(eligible[index]!.actorId);
    await select
      .locator('..')
      .getByRole('button', { name: 'Assign', exact: true })
      .click();
    await expect(async () => {
      view = await reread(page.request, view.id);
      expect(
        view.participants.some(
          (participant) =>
            participant.actorId === eligible[index]!.actorId &&
            participant.role === (index === 0 ? 'affirmative' : 'negative') &&
            participant.slot === 0,
        ),
      ).toBe(true);
    }).toPass({ timeout: 10_000 });
    await expect(
      select.locator('..').locator('[name="expectedVersion"]'),
    ).toHaveValue(String(view.version));
  }
  return claim(page, view, 'Judge 1');
}
