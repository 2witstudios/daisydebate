import type { Page } from '@playwright/test';
import { expect } from './fixtures';

/**
 * A human-judged round's result page (ISSUE-602): everyone reads the result
 * and the decision labelled by its kind of judge; each debater reads their
 * own coaching state and the frozen transcript; the judge, who did not
 * debate, reads no coaching.
 */
export async function expectRoundResult(
  pages: { readonly debaters: readonly Page[]; readonly judge: Page },
  result: string,
) {
  for (const page of [...pages.debaters, pages.judge]) {
    await expect(page.getByText(result, { exact: true })).toBeVisible();
    await expect(
      page.getByText('Official decision · Human judge', { exact: true }),
    ).toBeVisible();
  }
  for (const page of pages.debaters) {
    await expect(
      page.getByRole('heading', { name: 'AI coaching for you' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Transcript', exact: true }),
    ).toBeVisible();
  }
  await expect(
    pages.judge.getByRole('heading', { name: 'AI coaching for you' }),
  ).toHaveCount(0);
}
