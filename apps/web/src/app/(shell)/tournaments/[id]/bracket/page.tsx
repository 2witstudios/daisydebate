import { systemClock } from '@daisy/clock';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { SearchParams } from '../../../../../features/access/decision';
import { parseBracketView } from '../../../../../features/tournaments/bracket';
import { getBracket } from '../../../../../features/tournaments/get-bracket';
import { getEvent } from '../../../../../features/tournaments/get-event';
import { requestIdentity } from '../../../../../lib/request-session';
import {
  BracketPage,
  NotPosted,
} from '../../../../../ui/tournaments/bracket/bracket-page';

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
};

export const metadata: Metadata = { title: 'Bracket' };

/** Public: anyone can follow a tournament. */
export default async function BracketRoute({ params, searchParams }: Props) {
  const { id } = await params;
  const now = systemClock.now();
  const signedIn = (await requestIdentity()).state === 'member';
  const read = getBracket(id, signedIn, now);
  if (read.kind === 'not-found') notFound();
  if (read.kind === 'not-posted')
    return <NotPosted tournament={read.tournament} />;
  return (
    <BracketPage
      data={read.data}
      view={parseBracketView(
        await searchParams,
        read.data.tournament.structure,
      )}
      viewerHandle={read.viewerHandle}
      myEvent={signedIn && getEvent(id, now) !== null}
    />
  );
}
