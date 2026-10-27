import type { Metadata } from 'next';
import Link from 'next/link';
import type { SearchParams } from '../../../features/access/decision';
import { liveHref } from '../../../features/coming-soon/launch';
import { playOptions } from '../../../features/play/options';
import { requireAccess } from '../../../lib/access';
import { PageHeader } from '../../../ui/components/page-header/page-header';
import { ReadingPage } from '../../../ui/components/reading-page/reading-page';
import { PlayChoices } from '../../../ui/play/play-choices/play-choices';

export const metadata: Metadata = { title: 'Play' };

/**
 * The Play dialog's choices as a page: where the Lobby's Play link lands
 * when no script has run to open the dialog.
 */
export default async function PlayPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/play', searchParams);
  return (
    <ReadingPage>
      <PageHeader title="Play" />
      <PlayChoices options={playOptions} />
      <Link href={liveHref('lobby')} className="self-center font-strong">
        Just browse the Lobby
      </Link>
    </ReadingPage>
  );
}
