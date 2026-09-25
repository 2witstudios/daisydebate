import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  freshEmail,
  origin,
  resetRateLimits,
  signUpMember,
} from './support/accounts';
import { assertNoSeriousFindings } from './support/axe';
import { dropServerActions } from './support/forms';
import { effectsRan } from './support/hydration';

// ISSUE-107: a form disables its field and button while its answer is on
// the way, and a disabled control loses focus. With JavaScript on, each
// answer (sent, refused, or unavailable after a transport failure) must
// hand keyboard focus back to the form's field, or to the next step's
// heading, never leave it on <body>. Every answer here is reached with the
// keyboard alone: focus the field, type, press Enter.
test.beforeEach(async ({ request }) => {
  await resetRateLimits(request);
});

/** Types into `field` and submits with Enter, touching nothing else. */
const submitByKeyboard = async (field: Locator, value: string) => {
  // The page streams in behind the root loading boundary; a focus sent
  // before the reveal lands on the hidden copy (ISSUE-45).
  await expect(field).toBeVisible();
  await field.focus();
  await expect(field).toBeFocused();
  await field.page().keyboard.type(value);
  await field.page().keyboard.press('Enter');
};

/** Where focus is, read from the document itself. */
const activeElement = (page: Page) =>
  page.evaluate(() => {
    const active = document.activeElement;
    return { tag: active?.tagName.toLowerCase(), id: active?.id };
  });

/** `document.activeElement` settles on the element `tag#id`, never `<body>`. */
const expectFocusOn = (page: Page, tag: 'input' | 'h1', id: string) =>
  expect.poll(() => activeElement(page)).toEqual({ tag, id });

const openSignIn = async (page: Page) => {
  await page.goto('/sign-in?next=%2Flobby');
  await effectsRan(page);
};

const openSecurity = async (page: Page) => {
  const account = await signUpMember(page.request);
  await page.goto('/settings/security');
  await effectsRan(page);
  return account;
};

test('a sent sign-in link moves focus to the inbox step heading', async ({
  page,
}) => {
  await openSignIn(page);
  await submitByKeyboard(page.getByLabel('Email'), freshEmail());
  await expect(
    page.getByRole('heading', { name: /check your inbox/i }),
  ).toBeVisible();
  await expectFocusOn(page, 'h1', 'check-inbox-heading');
  await assertNoSeriousFindings(page);
});

test('a refused sign-in link returns focus to the email field', async ({
  page,
}) => {
  const email = freshEmail();
  // The recipient allowance is three links a minute: spend it, so the
  // form's request is the refused fourth.
  for (let sent = 0; sent < 3; sent += 1)
    expect(
      (
        await page.request.post('/api/auth/sign-in/magic-link', {
          headers: { origin },
          data: { email, callbackURL: '/lobby' },
        })
      ).status(),
    ).toBe(200);
  await openSignIn(page);
  await submitByKeyboard(page.getByLabel('Email'), email);
  await expect(page.getByText('Too many attempts for now.')).toBeVisible();
  await expectFocusOn(page, 'input', 'sign-in-email');
  await assertNoSeriousFindings(page);
});

test('a sign-in link lost in transport returns focus to the email field', async ({
  page,
}) => {
  await openSignIn(page);
  await dropServerActions(page);
  await submitByKeyboard(page.getByLabel('Email'), freshEmail());
  await expect(
    page.getByText('Sign-in is temporarily unavailable.'),
  ).toBeVisible();
  await expectFocusOn(page, 'input', 'sign-in-email');
  await assertNoSeriousFindings(page);
});

test('an accepted email change returns focus to the new-address field', async ({
  page,
}) => {
  await openSecurity(page);
  await submitByKeyboard(page.getByLabel('New email address'), freshEmail());
  await expect(page.locator('#email-change-notice')).toContainText(
    /approve this change/i,
  );
  await expectFocusOn(page, 'input', 'new-email');
  await assertNoSeriousFindings(page);
});

test('a refused email change returns focus to the new-address field', async ({
  page,
}) => {
  const { email } = await openSecurity(page);
  // Moving to the address already on file is refused as invalid.
  await submitByKeyboard(page.getByLabel('New email address'), email);
  await expect(page.locator('#email-change-notice')).toContainText(
    'That was not a valid request.',
  );
  await expectFocusOn(page, 'input', 'new-email');
  await assertNoSeriousFindings(page);
});

test('an email change lost in transport returns focus to the new-address field', async ({
  page,
}) => {
  await openSecurity(page);
  await dropServerActions(page);
  await submitByKeyboard(page.getByLabel('New email address'), freshEmail());
  await expect(page.locator('#email-change-notice')).toContainText(
    'Please try again.',
  );
  await expectFocusOn(page, 'input', 'new-email');
  await assertNoSeriousFindings(page);
});
