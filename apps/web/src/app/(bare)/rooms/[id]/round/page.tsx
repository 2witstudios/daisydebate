import { systemClock } from '@daisy/clock';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { SearchParams } from '../../../../../features/access/decision';
import type { RoundPhase } from '../../../../../features/debate-room/layout';
import { getRoomInfo } from '../../../../../features/rooms/get-room';
import { requireAccess } from '../../../../../lib/access';
import { DebateRoom } from '../../../../../ui/debate-room/room';
import { sampleRound } from '../../../../../ui/mock/debate-room';

export const metadata: Metadata = { title: 'Round' };

const phases: readonly RoundPhase[] = [
  'opponent-speaking',
  'cross-ex',
  'prep',
  'own-speech',
];

const phaseOf = (value: unknown): RoundPhase =>
  phases.find((phase) => phase === value) ?? 'opponent-speaking';

/** The debater's live round, full screen outside the shell, over the sample round. */
export default async function RoundRoute({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const query = await searchParams;
  await requireAccess(`/rooms/${id}/round`, searchParams);
  if (getRoomInfo(id, systemClock.now()) === null) notFound();
  return (
    <DebateRoom
      round={sampleRound(
        phaseOf(query.phase),
        query.rated === '1' ? 'rated' : 'unrated',
      )}
    />
  );
}
