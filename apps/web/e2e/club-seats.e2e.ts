import { expect, openPage, test } from './support/fixtures';
import { signUpMember } from './support/accounts';
import { fundClub } from './support/club-seats';
import { resolveE2EPorts } from '../playwright.config';

const mailBase = `http://127.0.0.1:${resolveE2EPorts(process.env).mail}`;

/** The invitation link from the newest seat invitation mailed to this address. */
async function invitationLink(
  request: import('@playwright/test').APIRequestContext,
  email: string,
) {
  let link: string | undefined;
  await expect(async () => {
    const response = await request.get(`${mailBase}/mails?to=${email}`);
    const mails = (await response.json()) as { text: string }[];
    link = mails
      .map(
        (mail) =>
          mail.text.match(/https:\/\/\S+\/clubs\/invitations\/\S+/)?.[0],
      )
      .filter(Boolean)
      .at(-1);
    expect(link).toBeTruthy();
  }).toPass({ timeout: 20_000 });
  return new URL(link!).pathname;
}

test('a manager invites by email, the invitee accepts, and Premium comes from the club (ADR 0148)', async ({
  browser,
}) => {
  const managerContext = await browser.newContext({ ignoreHTTPSErrors: true });
  const inviteeContext = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const manager = await openPage(managerContext, 'club manager');
    const invitee = await openPage(inviteeContext, 'seat invitee');
    const managerAccount = await signUpMember(manager.request);
    const inviteeAccount = await signUpMember(invitee.request);
    const { organizationId } = await fundClub({
      managerEmail: managerAccount.email,
      name: 'Northside Debate',
      seats: 3,
    });

    await expect(async () => {
      await manager.goto(`/clubs/${organizationId}/seats`);
      await expect(
        manager.getByRole('heading', { name: 'Seats', exact: true }),
      ).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await manager.getByLabel('Email').fill(inviteeAccount.email.toUpperCase());
    await manager.getByRole('button', { name: 'Send invitation' }).click();
    await expect(manager.getByRole('status')).toContainText('Invitation sent');
    await expect(manager.getByText(inviteeAccount.email)).toBeVisible();

    const path = await invitationLink(invitee.request, inviteeAccount.email);
    await managerContext.request
      .get(path)
      .then((response) => expect(response.status()).toBe(404));
    await invitee.goto(path);
    await expect(invitee.getByText('Northside Debate').first()).toBeVisible();
    await invitee.getByRole('button', { name: 'Accept the seat' }).click();
    await expect(invitee.getByRole('status')).toContainText(
      'hold a seat in Northside Debate',
    );
    await invitee.getByRole('link', { name: 'See your billing' }).click();
    await expect(invitee).toHaveURL(/\/settings\/billing/);
    await expect(invitee.getByText('Seat from Northside Debate')).toBeVisible();
    const settings = await invitee.request.get('/api/billing/settings');
    const view = await settings.json();
    expect(view.plan).toBe('club-seat');
    expect(view.club.name).toBe('Northside Debate');
    expect(view.checkoutAvailable).toBe(false);

    await manager.goto(`/clubs/${organizationId}/seats`);
    await expect(
      manager
        .getByRole('region', { name: 'Club members and seats' })
        .getByRole('listitem')
        .filter({ hasText: `@${inviteeAccount.username}` }),
    ).toContainText('Premium seat');
  } finally {
    await managerContext.close();
    await inviteeContext.close();
  }
});
