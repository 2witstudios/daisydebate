import type { Metadata } from 'next';
import type { SearchParams } from '../../../../features/access/decision';
import { answerEditHrefs } from '../../../../ui/onboarding/answer-summary/answer-summary';
import { listBots } from '../../../../features/train/bots';
import { readOnboardingAnswers } from '../answers';
import { ReadyStep } from '../../../../ui/onboarding/ready/ready';
import { readStepEntry, stepRobots } from '../step-entry';
import { requestOptionalAnswersAdmitted } from '../../../../lib/request-session';

export const metadata: Metadata = {
  title: 'Your first debate',
  robots: stepRobots,
};

/** The last step: a first debate against a bot or a person. */
export default async function OnboardingReadyPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { destination } = await readStepEntry(searchParams, 'ready');
  return (
    <ReadyStep
      answers={await readOnboardingAnswers()}
      botNames={listBots().map((bot) => bot.name)}
      homeHref={destination}
      editHrefs={
        (await requestOptionalAnswersAdmitted())
          ? answerEditHrefs(destination)
          : null
      }
    />
  );
}
