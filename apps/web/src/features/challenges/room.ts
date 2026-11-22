import type { CompetitionType } from '@daisy/protocol/round';
import type { RatingStyle } from '@daisy/protocol/primitives';
import { casualSelection } from '../rooms/format-browser';
import type { RoomTemplate } from '../rooms/read-catalog';
import { defaultRoomVisibility } from '../rooms/room-visibility';

/**
 * The room an accepted challenge opens (ADR 0103), through the one room-create
 * form on the ladder's format they agreed: Freestyle, which strikes its
 * resolution (ADR 0142). Both modes are public, the Room default:
 * casual like any Room nobody chose otherwise for, and ranked because it is
 * always public, so a human judge can find it and a public result counts on
 * both records. The two debater seats stay held for the two of them while
 * they arrive.
 */
export function challengeRoomForm(input: {
  readonly host: string;
  readonly hostActorId: string;
  readonly opponent: string;
  readonly opponentActorId: string;
  readonly mode: CompetitionType;
  /** The lobby the pair shares (ADR 0162): the Room opens there. */
  readonly lobbyId: string;
  readonly template: RoomTemplate;
  readonly commandId: string;
}): FormData {
  const form = new FormData();
  form.set('commandId', input.commandId);
  form.set('title', `@${input.opponent} vs @${input.host}`);
  form.set('resolutionMethod', 'strike');
  form.set('lobby', input.lobbyId);
  // Ranked is always public; casual takes the Room default, also public.
  form.set(
    'visibility',
    input.mode === 'ranked' ? 'public' : defaultRoomVisibility,
  );
  // A public room is listed at once: the hold keeps both debater seats theirs
  // while they arrive (ADR 0103 §4); the judge seat stays open to anyone.
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
  format: RatingStyle,
): RoomTemplate | undefined =>
  choices.find((choice) => choice.formatId === format);
