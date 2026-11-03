import { StageRoom } from '../../../../ui/broadcast/stage-room';

/** Rendered only by Egress. It holds nothing until its credential opens the API. */
export default async function StagePage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ broadcastId: string }>;
  readonly searchParams: Promise<{ c?: string }>;
}) {
  const { broadcastId } = await params;
  const { c } = await searchParams;
  return <StageRoom broadcastId={broadcastId} credential={c ?? ''} />;
}
