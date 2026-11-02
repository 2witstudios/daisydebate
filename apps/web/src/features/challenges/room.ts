import type {
  RatingLadder,
  CompetitionType,
  PublishedResolution,
} from '@daisy/protocol';
import { casualSelection } from '../rooms/format-browser';
import type { RoomTemplate } from '../rooms/read-catalog';

/**
 * The room an accepted challenge opens (ADR 0098), through the one room-create
 * form on the format they agreed. Casual is unlisted, so only the two of them
 * reach it. Ranked takes the ranked selection and is public: a human judge has
 * to be able to find it, a public result counts on both records, and the two
 * debater seats stay held for the two of them while they arrive.
 */
export function challengeRoomForm(input: {
  readonly host: string;
  readonly hostActorId: string;
  readonly opponent: string;
  readonly opponentActorId: string;
  readonly mode: CompetitionType;
  readonly template: RoomTemplate;
  readonly commandId: string;
  readonly resolutions: readonly PublishedResolution[];
}): FormData {
  const form = new FormData();
  form.set('commandId', input.commandId);
  form.set('title', `@${input.opponent} vs @${input.host}`);
  const method = input.template.preset.config.resolutionDraw.enabled
    ? 'strike'
    : input.template.formatId === 'policy'
      ? 'policy'
      : 'value';
  form.set('resolutionMethod', method);
  const publication = input.resolutions.find(
    (resolution) => resolution.kind === method,
  );
  if (publication) form.set(`${publication.kind}ResolutionId`, publication.id);
  form.set('visibility', input.mode === 'ranked' ? 'public' : 'unlisted');
  // A public room is listed at once: nobody else may take their seats.
  form.append('holdSeatFor', input.hostActorId);
  form.append('holdSeatFor', input.opponentActorId);
  const casual = casualSelection(input.template);
  form.set(
    'selection',
    JSON.stringify(
      input.mode === 'ranked'
        ? {
            kind: 'ranked',
            formatId: casual.formatId,
            formatVersion: casual.formatVersion,
            presetVersion: casual.presetVersion,
          }
        : casual,
    ),
  );
  return form;
}

/** The catalog entry a challenge's format names, if the catalog still has it. */
export const templateFor = (
  choices: readonly RoomTemplate[],
  format: RatingLadder,
): RoomTemplate | undefined =>
  choices.find((choice) => choice.formatId === format);
