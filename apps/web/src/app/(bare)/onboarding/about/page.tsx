import type { Metadata } from 'next';
import type { SearchParams } from '../../../../features/access/decision';
import { QuestionPage } from '../question-page';
import { stepRobots } from '../step-entry';

export const metadata: Metadata = { title: 'About you', robots: stepRobots };

export default function OnboardingAboutPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  return <QuestionPage step="about" searchParams={searchParams} />;
}
