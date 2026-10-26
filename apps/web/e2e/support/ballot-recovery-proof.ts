import type { Locator, Page } from '@playwright/test';
import { expect } from './fixtures';
import { readBallotRound, ballotRoundCommand } from './human-ballot-round';
import type { humanBallotFixtures } from './human-ballot-fixtures';
const formEntries = (form: Locator) =>
  form.evaluate((node) => {
    if (!(node instanceof HTMLFormElement))
      throw new Error('Actual ballot form missing');
    return Object.fromEntries(
      [...new FormData(node)].filter(([key]) => !key.startsWith('$ACTION_')),
    );
  });
export async function proveBallotRecovery(
  page: Page,
  fixtures: Awaited<ReturnType<typeof humanBallotFixtures>>,
) {
  const roundId = fixtures.rounds[4]!.id;
  const path = `/judge/ballot/${roundId}`;
  await page.goto(path);
  await page.locator('label', { hasText: fixtures.negative }).first().click();
  await page
    .getByLabel('Reason for decision')
    .fill('The negative compared the decisive impacts.');
  const original = await formEntries(
    page.getByRole('form', { name: 'Your ballot', exact: true }),
  );
  let committed = false;
  await page.route(
    (url) => url.pathname === path,
    async (route) => {
      if (committed || route.request().method() !== 'POST')
        return route.continue();
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      committed = true;
      await route.fulfill({
        status: 503,
        contentType: 'text/plain',
        body: 'Acknowledgement unavailable',
      });
    },
  );
  await page
    .getByRole('button', { name: 'Submit ballot', exact: true })
    .click();
  const retry = page.getByRole('form', {
    name: 'Retry unacknowledged ballot',
    exact: true,
  });
  await expect(
    retry.getByRole('button', { name: 'Retry original ballot', exact: true }),
  ).toBeEnabled();
  expect(committed).toBe(true);
  const guest = fixtures.members[1]!.context.request;
  const privateResponse = await guest.get(`/api/rounds/${roundId}/ballots`);
  expect(privateResponse.status()).toBe(200);
  const privateView = await privateResponse.json();
  expect(privateView.own).toBeNull();
  expect(privateView.freeze).toBeNull();
  expect(privateView.ballots).toEqual([]);
  expect(JSON.stringify(privateView)).not.toContain(
    fixtures.members[2]!.username,
  );
  const current = await readBallotRound(guest, roundId);
  const seat = current.participants.find(
    (p) => p.role === 'negative' && 'id' in p,
  );
  if (!seat || !('id' in seat)) throw new Error('Actual negative seat missing');
  await ballotRoundCommand(guest, current, {
    type: 'forfeit',
    participantId: seat.id,
  });
  await page.getByRole('link', { name: 'Refresh Round', exact: true }).click();
  await expect(
    page.getByText(
      'This Round has ended. Your original submission can still be retried.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    retry.getByRole('button', { name: 'Retry original ballot', exact: true }),
  ).toBeEnabled();
  expect(await formEntries(retry)).toEqual(original);
  await retry
    .getByRole('button', { name: 'Retry original ballot', exact: true })
    .click();
  await expect(
    page.getByText('Ballot submitted.', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText('Round outcome: affirmative', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Submit ballot', exact: true }),
  ).toHaveCount(0);
}
