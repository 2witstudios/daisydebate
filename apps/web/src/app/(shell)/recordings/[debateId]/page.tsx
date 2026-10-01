import type { Metadata } from 'next';
import type { SearchParams } from '../../../../features/access/decision';
import { openReplay } from '../../../../features/watch/open-replay';
import { parseReplayQuery } from '../../../../features/watch/replay-query';
import { replayHref } from '../../../../features/watch/routes';
import { viewerOf } from '../../../../features/watch/viewer';
import { requireAccess } from '../../../../lib/access';
import { Replay } from '../../../../ui/watch/replay/replay';
import { ReplayRefusal } from '../../../../ui/watch/replay-refusal/replay-refusal';

export const metadata: Metadata = { title: 'Replay' };

/** The guarded replay of a recorded debate, with its visibility manager. */
export default async function ReplayPage({
  params,
  searchParams,
}: {
  params: Promise<{ debateId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { debateId } = await params;
  const identity = await requireAccess(replayHref(debateId), searchParams);
  const screen = openReplay(
    debateId,
    viewerOf(identity),
    parseReplayQuery(await searchParams),
  );
  return screen.kind === 'watch' ? (
    <Replay view={screen.view} />
  ) : (
    <div className="px-6 pt-8 pb-8 max-compact:px-4">
      <ReplayRefusal screen={screen} />
    </div>
  );
}
