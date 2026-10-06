import { expect, test } from './support/fixtures';
import { signUpMember } from './support/accounts';
import { assertNoSeriousFindings } from './support/axe';
import { gotoWithTheme } from './support/theme';

// The onboarding steps after the passkey offer, in both themes and at the
// narrowest supported width (WCAG 1.4.10 reflow).
const onboardingSteps = [
  '/onboarding/welcome?next=%2Flobby',
  '/onboarding/daisy?next=%2Flobby',
  '/onboarding/debate?next=%2Flobby',
  '/onboarding/about?next=%2Flobby',
  '/onboarding/experience?next=%2Flobby',
  '/onboarding/topics?next=%2Flobby',
  '/onboarding/ready?next=%2Flobby',
];

test('every onboarding step has no serious or critical accessibility findings in dark or light', async ({
  page,
}) => {
  test.slow();
  await signUpMember(page.request);
  for (const path of onboardingSteps)
    for (const theme of ['dark', 'light'] as const) {
      await gotoWithTheme(page, path, theme);
      await expect(page.getByRole('dialog')).toBeVisible();
      await assertNoSeriousFindings(page);
    }
});

test('every onboarding step stays usable with no horizontal overflow at 320 px', async ({
  page,
}) => {
  await signUpMember(page.request);
  await page.setViewportSize({ width: 320, height: 640 });
  for (const path of onboardingSteps) {
    await page.goto(path);
    const overflowsHorizontally = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1,
    );
    expect(overflowsHorizontally, path).toBe(false);
  }
});
