import type { Browser } from '@playwright/test';
import { createHumanJudgeProofAccounts } from './human-judge-accounts';
import { playHumanBallotRound } from './human-ballot-round';
import { maintainHumanBallotFixtures } from './human-ballot-maintenance';
import { expect, openPage } from './fixtures';
/** Real played intervals and the immutable 120-second cutoff; fixture-invoked finalization is an explicit D5 boundary. */
export async function humanBallotFixtures(browser: Browser) {
  const accounts = await createHumanJudgeProofAccounts(browser);
  try {
    const rounds = [];
    for (let index = 0; index < 5; index++)
      rounds.push(
        await playHumanBallotRound(
          accounts.members,
          maintainHumanBallotFixtures,
        ),
      );
    await maintainHumanBallotFixtures(
      rounds.map((round) => round.id),
      true,
    );
    const recorded = rounds[3]!;
    const page = await openPage(
      accounts.members[2]!.context,
      'actual recorded ballot fixture',
    );
    await page.goto(`/judge/ballot/${recorded.id}`);
    await page
      .locator('label', { hasText: accounts.members[0]!.username })
      .first()
      .click();
    await page
      .getByLabel('Reason for decision')
      .fill('The affirmative answered the decisive clash.');
    await page
      .getByRole('button', { name: 'Submit ballot', exact: true })
      .click();
    await expect(
      page.getByText('Ballot submitted.', { exact: false }),
    ).toBeVisible();
    await page.close();
    return {
      ...accounts,
      rounds,
      affirmative: accounts.members[0]!.username,
      negative: accounts.members[1]!.username,
    };
  } catch (error) {
    await accounts.closeContexts();
    throw error;
  }
}
