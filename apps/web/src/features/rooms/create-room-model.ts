import type { RoomCatalogChoice } from '@daisy/protocol';
import { createRoomDraft, type CreateRoomDraft } from './create-room-draft';
import { draftFormValues, readRoomDraft } from './create-room-fields';
import { changeDraftSchedule } from './prepare-room-draft';
import { defaultRoomVisibility } from './room-visibility';

/** The editor's one state: the form's named values and the draft they decode to. */
export type CreateRoomModel = {
  readonly values: Readonly<Record<string, string>>;
  readonly draft: CreateRoomDraft;
};

/** The editor opens on `initialChoice`, carrying a refused post's values back (ADR 0070). */
export function initialRoomModel(
  initialChoice: RoomCatalogChoice,
  choices: readonly RoomCatalogChoice[],
  kept: Readonly<Record<string, string>>,
  initialRanked: boolean,
): CreateRoomModel {
  const defaults = createRoomDraft(initialChoice);
  const values: Record<string, string> = {
    ...draftFormValues(defaults),
    title: '',
    visibility: defaultRoomVisibility,
    ...kept,
    // A native post's intent was its submitter's act, already consumed; a
    // stale one would make readRoomDraft reset the preset on the next edit.
    intent: '',
  };
  if (
    initialRanked &&
    Object.keys(kept).length === 0 &&
    initialChoice.preset.rankedEligible
  )
    values.ranked = 'on';
  const parsed = readRoomDraft(values, choices);
  return {
    values,
    draft: parsed.ok ? parsed.draft : defaults,
  };
}

/**
 * One named value changes and the draft re-decodes. The format radio reads
 * the decoded draft — `draft.custom` — never a forced label, so a reverted
 * edit reads as its standard again. Any edit is a customization: it un-ranks.
 */
export function changeRoomValue(
  model: CreateRoomModel,
  name: string,
  value: string,
  choices: readonly RoomCatalogChoice[],
): CreateRoomModel {
  const next = { ...model.values, [name]: value, ranked: '' };
  const read = readRoomDraft(next, choices);
  return {
    values: next,
    draft: read.ok
      ? read.draft
      : { ...model.draft, custom: true, ranked: false },
  };
}

/** The host names a catalog choice: the draft resets to it, values follow. */
export function chooseRoomChoice(
  model: CreateRoomModel,
  choice: RoomCatalogChoice,
): CreateRoomModel {
  const selected = createRoomDraft(choice);
  return {
    values: { ...model.values, ...draftFormValues(selected), intent: '' },
    draft: selected,
  };
}

/** A schedule intent edits the draft; an undecodable model stays as it is. */
export function scheduleRoomDraft(
  model: CreateRoomModel,
  intent: string,
  choices: readonly RoomCatalogChoice[],
): CreateRoomModel {
  const read = readRoomDraft(model.values, choices);
  if (!read.ok) return model;
  const edited = changeDraftSchedule(read.draft, intent);
  return {
    values: { ...model.values, ...draftFormValues(edited) },
    draft: edited,
  };
}
