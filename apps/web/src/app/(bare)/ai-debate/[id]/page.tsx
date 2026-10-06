import type { Metadata } from 'next';
import type { SearchParams } from '../../../../features/access/decision';
import { requireAccess } from '../../../../lib/access';
import { AiDebateRoom } from '../../../../ui/ai-debate/room/room';

export const metadata: Metadata = { title: 'AI debate' };

/** The debate room. Voice needs JavaScript; without it the notice says so. */
export default async function AiDebateRoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/ai-debate', searchParams);
  const { id } = await params;
  return (
    <>
      <noscript>
        <p className="px-6 pt-5 text-ink">
          A voice debate needs JavaScript to use your microphone. Turn it on to
          debate the AI.
        </p>
      </noscript>
      <AiDebateRoom id={id} />
    </>
  );
}
