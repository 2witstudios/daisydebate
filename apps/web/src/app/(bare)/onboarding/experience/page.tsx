import type { Metadata } from 'next';
import type { SearchParams } from '../../../../features/access/decision';
import { QuestionPage } from '../question-page';
import { stepRobots } from '../step-entry';

export const metadata: Metadata = { title: 'Experience', robots: stepRobots };

export default function OnboardingExperiencePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  return <QuestionPage step="experience" searchParams={searchParams} />;
}
