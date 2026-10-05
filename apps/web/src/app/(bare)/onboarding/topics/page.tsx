import type { Metadata } from 'next';
import type { SearchParams } from '../../../../features/access/decision';
import { QuestionPage } from '../question-page';
import { stepRobots } from '../step-entry';

export const metadata: Metadata = { title: 'Topics', robots: stepRobots };

export default function OnboardingTopicsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  return <QuestionPage step="topics" searchParams={searchParams} />;
}
