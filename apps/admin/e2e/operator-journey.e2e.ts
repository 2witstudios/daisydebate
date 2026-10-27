import { execFileSync } from 'node:child_process';
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

/**
 * The owner's first visit (BETA-4, BETA-5): the bootstrap CLI mints a link,
 * a virtual authenticator with user verification creates the passkey, the
 * same passkey signs in, approves a pending account through the operator
 * API stand-in (which verifies every signature with the real verifier), and
 * the audit page shows the chain it wrote and the anchor it sent.
 */
const enrollCli = new URL('../src/scripts/operator-enroll.ts', import.meta.url);
const enrollmentUrl = (): string => {
  const output = execFileSync(
    'bun',
    [fileURLToPath(enrollCli), '--name', 'owner'],
    { encoding: 'utf8', env: { ...process.env, ...serverEnv() } },
  );
  const url = output.split('\n').find((line) => line.startsWith('http://'));
  if (!url) throw new Error('operator-enroll printed no URL');
  return url;
};

function serverEnv() {
  const owner = new URL(process.env.E2E_ADMIN_DATABASE_URL ?? '');
  owner.username = 'daisy_admin_e2e';
  owner.password = 'admin-e2e-loopback-only';
  return {
    ADMIN_DATABASE_URL: owner.toString(),
    ADMIN_ATTEMPT_KEY: 'admin-e2e-attempt-key-loopback-only-000000',
  };
}

test('enroll a passkey, sign in, and approve a pending account', async ({
  page,
  context,
}) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send(
    'WebAuthn.addVirtualAuthenticator',
    {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    },
  );

  await page.goto(enrollmentUrl());
  await page.getByRole('button', { name: 'Create passkey' }).click();
  await expect(page).toHaveURL(/\/sign-in\?enrolled=1$/);
  const { credentials } = await cdp.send('WebAuthn.getCredentials', {
    authenticatorId,
  });
  expect(credentials).toHaveLength(1);

  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await expect(page).toHaveURL(/\/accounts$/);
  await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();

  const cookie = (await context.cookies()).find(
    ({ name }) => name === 'daisy_admin_session',
  );
  expect(cookie).toMatchObject({
    httpOnly: true,
    sameSite: 'Strict',
    path: '/',
  });

  const pending = page.getByRole('row', { name: /pending-player/ });
  await expect(pending).toContainText('2026-10-25T09:00:00.123456Z');
  await page.getByRole('button', { name: 'Approve pending-player' }).click();
  await expect(page.getByTestId('command-notice')).toHaveText(
    'Done. Approval email queued.',
  );
  await expect(page.getByText('No pending accounts.')).toBeVisible();
  await page.getByRole('link', { name: 'Approved' }).click();
  await expect(
    page
      .getByRole('row', { name: /pending-player/ })
      .getByRole('cell', { name: '2', exact: true }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Audit' }).click();
  await expect(page.getByTestId('chain-badge')).toHaveText(
    'Chain consistent (seq 1–5); 1 anchor sent',
  );
  await expect(page.locator('tbody tr').first()).toContainText(
    'command.outcome',
  );
  await expect(page.locator('tbody tr').first()).toContainText('changed');

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto('/accounts');
  await expect(page).toHaveURL(/\/sign-in$/);
});

/** A raw request, so the test controls Host and Origin exactly. */
const statusOf = (input: {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
}) =>
  new Promise<number | undefined>((resolve, reject) => {
    const sent = request(
      { host: 'localhost', port: 4800, ...input },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    );
    sent.once('error', reject);
    sent.end();
  });

test('the real server answers a foreign Host or Origin with 421', async () => {
  expect(
    await statusOf({
      method: 'GET',
      path: '/sign-in',
      headers: { host: '127.0.0.1:4800' },
    }),
  ).toBe(421);
  expect(
    await statusOf({
      method: 'POST',
      path: '/sign-in',
      headers: { host: 'localhost:4800', origin: 'http://attacker.example' },
    }),
  ).toBe(421);
  expect(
    await statusOf({
      method: 'GET',
      path: '/sign-in',
      headers: { host: 'localhost:4800' },
    }),
  ).toBe(200);
});
