import type { APIRequestContext, Page } from '@playwright/test';
import { roomViewSchema, type RoomView } from '@daisy/protocol';
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
  await page.locator('a[href="/play/room"]').click();
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
  return reread(page.request, view.id);
}
