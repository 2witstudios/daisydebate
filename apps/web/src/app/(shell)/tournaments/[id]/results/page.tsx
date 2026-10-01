import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { SearchParams } from '../../../../../features/access/decision';
import { getResults } from '../../../../../features/tournaments/get-results';
import { parseResultsQuery } from '../../../../../features/tournaments/results';
import { requestIdentity } from '../../../../../lib/request-session';
import {
  ResultsPage,
  ResultsUnpublished,
} from '../../../../../ui/tournaments/results/results-page';

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
};

export const metadata: Metadata = { title: 'Results' };

/** Public: anyone can read published results; "Your result" needs an account. */
export default async function ResultsRoute({ params, searchParams }: Props) {
  const { id } = await params;
  const signedIn = (await requestIdentity()).state === 'member';
  const read = getResults(id, signedIn);
  if (read.kind === 'not-found') notFound();
  if (read.kind === 'unpublished')
    return <ResultsUnpublished name={read.tournament.name} id={id} />;
  return (
    <ResultsPage
      data={read.data}
      query={parseResultsQuery(await searchParams, read.data.mine !== null)}
      viewerHandle={signedIn ? 'debater-a' : null}
    />
  );
}
