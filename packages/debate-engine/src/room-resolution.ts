import type {
  PublishedResolution,
  RoomResolutionSelection,
} from '@daisy/protocol';

/** Published text is trusted only after the adapter has resolved the requested identity. */
export function decideRoomResolution({
  selection,
  publication,
  formatId,
  standard,
  strikes,
}: {
  readonly selection: RoomResolutionSelection;
  readonly publication: PublishedResolution | null;
  readonly formatId: string;
  readonly standard: boolean;
  readonly strikes: boolean;
}):
  | {
      readonly ok: true;
      readonly topic: string | null;
      readonly publishedResolutionId: string | null;
    }
  | { readonly ok: false } {
  if (
    standard &&
    selection.kind !== (formatId === 'freestyle' ? 'strike' : formatId)
  )
    return { ok: false };
  if ((selection.kind === 'strike') !== strikes) return { ok: false };
  if (selection.kind === 'strike')
    return { ok: true, topic: null, publishedResolutionId: null };
  if (selection.kind === 'custom')
    return { ok: true, topic: selection.text, publishedResolutionId: null };
  if (
    !publication ||
    publication.id !== selection.id ||
    publication.kind !== selection.kind
  )
    return { ok: false };
  return {
    ok: true,
    topic: publication.text,
    publishedResolutionId: publication.id,
  };
}
