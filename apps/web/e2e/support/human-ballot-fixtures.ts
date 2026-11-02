import type { Browser, BrowserContext } from '@playwright/test';
import { createHumanJudgeProofAccounts } from './human-judge-accounts';
import { playHumanBallotRound } from './human-ballot-round';
import { maintainHumanBallotFixtures } from './human-ballot-maintenance';
import { expect, openPage } from './fixtures';
/** One judge's real ballot through the page, on a frozen Round. */
export async function submitJudgeBallot(
  judge: { readonly context: BrowserContext },
  roundId: string,
  ballot: { readonly winner: string; readonly reason: string },
) {
  const page = await openPage(judge.context, 'actual judge ballot');
  await page.goto(`/judge/ballot/${roundId}`);
  await page.locator('label', { hasText: ballot.winner }).first().click();
  await page.getByLabel('Reason for decision').fill(ballot.reason);
  await page
    .getByRole('button', { name: 'Submit ballot', exact: true })
    .click();
  await expect(
    page.getByText('Ballot submitted.', { exact: false }),
  ).toBeVisible();
  await page.close();
}
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
    await submitJudgeBallot(accounts.members[2]!, rounds[3]!.id, {
      winner: accounts.members[0]!.username,
      reason: 'The affirmative answered the decisive clash.',
    });
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
