import type {
  ChallengeFormat,
  ChallengeMode,
  PublishedResolution,
} from '@daisy/protocol';
import { casualSelection } from '../rooms/format-browser';
import type { RoomTemplate } from '../rooms/read-catalog';

/**
 * The room an accepted challenge opens (ADR 0098): unlisted, so only the two of
 * them reach it, on the format they agreed, through the one room-create form.
 * A ranked challenge takes the ranked selection and so its judge requirement.
 */
export function challengeRoomForm(input: {
  readonly host: string;
  readonly opponent: string;
  readonly mode: ChallengeMode;
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
  form.set('visibility', 'unlisted');
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
  format: ChallengeFormat,
): RoomTemplate | undefined =>
  choices.find((choice) => choice.formatId === format);
