import type { Metadata } from 'next';
import Link from 'next/link';
import type { SearchParams } from '../../../features/access/decision';
import { destinationHref } from '../../../features/destinations/destinations';
import { playOptionsFor } from '../../../features/play/options';
import { botDebatesReleasedTo } from '../../../features/bot-debates/release';
import { requireAccess } from '../../../features/access/page-access';
import { PageHeader } from '../../../ui/components/page-header/page-header';
import { ReadingPage } from '../../../ui/components/reading-page/reading-page';
import { PlayChoices } from '../../../ui/play/play-choices/play-choices';

export const metadata: Metadata = { title: 'Play' };

/**
 * The Play dialog's choices as a page: where the Lobby's Play link lands
 * when nothing has hydrated to open the dialog.
 */
export default async function PlayPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const identity = await requireAccess('/play', searchParams);
  return (
    <ReadingPage>
      <PageHeader title="Play" />
      <PlayChoices
        options={playOptionsFor(await botDebatesReleasedTo(identity))}
      />
      <Link href={destinationHref('lobby')} className="self-center font-strong">
        Just browse the Lobby
      </Link>
    </ReadingPage>
  );
}
