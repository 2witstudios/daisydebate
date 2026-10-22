import { test } from './support/fixtures';
import { proveHumanJudgedJourney } from './support/human-judged-journey';
import { proveUnjudgedJourney } from './support/unjudged-journey';
import { proveHumanBotJourney } from './support/bot-journey';

/**
 * Whole Rounds through the production server's autonomous services: no
 * fixture clock, maintenance callback, seeded ledger, transcript or ballot.
 */
test('actual shared human judging completes through autonomous maintenance and native/enhanced ballots', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  await proveHumanJudgedJourney(browser);
});

test('actual zero-judge Round finishes unjudged through autonomous maintenance', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  await proveUnjudgedJourney(browser);
});

test('actual human against a bot is spoken by the provider and decided by the AI judge', async ({
  browser,
}) => {
  test.setTimeout(420_000);
  await proveHumanBotJourney(browser);
});
