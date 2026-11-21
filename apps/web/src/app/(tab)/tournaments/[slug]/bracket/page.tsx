import { notFound } from 'next/navigation';
import { TournamentResults } from '../tournament-results';

export default async function Page({
  params,
  searchParams,
}: {
  readonly params: Promise<{ slug: string }>;
  readonly searchParams: Promise<{ event?: string | string[] }>;
}) {
  const [{ slug }, { event }] = await Promise.all([params, searchParams]);
  if (Array.isArray(event)) notFound();
  return (
    <TournamentResults slug={slug} eventId={event ?? null} section="bracket" />
  );
}
