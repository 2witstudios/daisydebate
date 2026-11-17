import type { RoomCatalogChoice, RoomCreate } from '@daisy/protocol';
import { resolveRoomConfiguration } from '@daisy/debate-engine';
import { formValues } from '../forms/form-state';
import { draftFormValues, readRoomDraft } from './create-room-fields';
import { editRoomDraft, type CreateRoomDraft } from './create-room-draft';
import { customRoomDefinition } from './custom-room-definition';
import { casualCaptureNotice } from '../legal/agreements';

type Definition = CreateRoomDraft['definition'];

/**
 * A new speech for a declared side (`add-side:<key>`), or a question period
 * asked by the format's last side, as Daisy's two-sided formats ask from the
 * second; an unsided format's new period is everyone's.
 */
function addedSegment(
  definition: Definition,
  intent: string,
  sideKey: string | undefined,
): Omit<Definition['segments'][number], 'key'> | null {
  if (intent === 'add-question') {
    const asker = definition.sides.at(-1);
    return {
      label: 'Question period',
      type: 'cross_ex',
      speak: {
        rights: 'all',
        lead: asker ? { kind: 'side', side: asker.key, slot: 0 } : null,
      },
      defaultDurationMs: 180_000,
    };
  }
  const side = definition.sides.find((declared) => declared.key === sideKey);
  if (!side) return null;
  return {
    label: `${side.label} speech`,
    type: 'speech',
    speak: { rights: 'one', seat: { kind: 'side', side: side.key, slot: 0 } },
    defaultDurationMs: 180_000,
  };
}

/** Shared by native editing actions and the enhanced editor. */
export function changeDraftSchedule(
  draft: CreateRoomDraft,
  intent: string,
): CreateRoomDraft {
  const segments = [...draft.definition.segments];
  const [operation, position] = intent.split(':');
  const index = Number(position);
  if (operation === 'remove' && Number.isInteger(index) && segments[index])
    segments.splice(index, 1);
  else if (
    (operation === 'up' || operation === 'down') &&
    Number.isInteger(index) &&
    segments[index]
  ) {
    const to = index + (operation === 'up' ? -1 : 1);
    if (!segments[to]) return draft;
    [segments[index], segments[to]] = [segments[to]!, segments[index]!];
  } else if (operation === 'add-side' || intent === 'add-question') {
    if (segments.length >= 64) return draft;
    const segment = addedSegment(draft.definition, intent, position);
    if (!segment) return draft;
    let n = segments.length + 1;
    while (segments.some((item) => item.key === `s${n}`)) n += 1;
    segments.push({ ...segment, key: `s${n}` });
  } else return draft;
  const keys = new Set(segments.map((segment) => segment.key));
  return editRoomDraft(draft, {
    definition: customRoomDefinition({ ...draft.definition, segments }),
    config: {
      ...draft.config,
      speechTiming: {
        ...draft.config.speechTiming,
        segmentDurationOverrides: Object.fromEntries(
          Object.entries(
            draft.config.speechTiming.segmentDurationOverrides,
          ).filter(([key]) => keys.has(key)),
        ),
      },
    },
  });
}

function selectionOf(draft: CreateRoomDraft): RoomCreate['selection'] {
  const tuple = {
    formatId: draft.basis.formatId,
    formatVersion: draft.basis.formatVersion,
    presetVersion: draft.basis.preset.version,
  };
  if (!draft.custom)
    return draft.ranked
      ? { kind: 'ranked', ...tuple }
      : { kind: 'catalog', ...tuple, competitionType: 'casual' };
  return {
    kind: 'custom',
    definition: customRoomDefinition(draft.definition),
    config: draft.config,
    competitionType: 'casual',
    basis: tuple,
  };
}

export function prepareRoomDraft(
  form: FormData,
  choices: readonly RoomCatalogChoice[],
):
  | {
      readonly kind: 'preview';
      readonly values: Readonly<Record<string, string>>;
    }
  | { readonly kind: 'submit'; readonly form: FormData }
  | { readonly kind: 'invalid'; readonly error: string } {
  if (
    [...form.keys()].some(
      (key) => !key.startsWith('$ACTION_') && form.getAll(key).length !== 1,
    )
  )
    return { kind: 'invalid', error: 'Reload the form and try again.' };
  const values = formValues(form);
  const parsed = readRoomDraft(values, choices);
  if (!parsed.ok) return { kind: 'invalid', error: parsed.error };
  const intent = values.intent ?? 'create';
  const draft = changeDraftSchedule(parsed.draft, intent);
  if (intent !== 'create')
    return {
      kind: 'preview',
      values: { ...values, ...draftFormValues(draft), intent: '' },
    };
  // A casual recording form that states a notice must state the current one, so
  // show it again before claiming it; a form that showed none owes none.
  if (
    !draft.ranked &&
    values.recording === 'on' &&
    values.noticeVersion &&
    values.noticeVersion !== casualCaptureNotice.version
  )
    return {
      kind: 'preview',
      values: { ...values, ...draftFormValues(draft), intent: '' },
    };
  const selection = selectionOf(draft);
  const compiled = resolveRoomConfiguration(
    selection.kind === 'custom' ? selection.definition : draft.definition,
    draft.config,
  );
  if (!compiled.ok)
    return {
      kind: 'invalid',
      error: 'Check the speech order, times and room settings.',
    };
  const method = draft.resolutionMethod;
  if (method === 'custom' && !draft.customResolution.trim())
    return { kind: 'invalid', error: 'Enter a custom resolution.' };
  const submitted = new FormData();
  for (const [key, value] of form) submitted.append(key, value);
  submitted.set('selection', JSON.stringify(selection));
  submitted.set('competition', draft.ranked ? 'ranked' : 'casual');
  if (draft.ranked) submitted.set('visibility', 'public');
  submitted.set('resolutionMethod', method);
  submitted.set('customResolution', draft.customResolution);
  return { kind: 'submit', form: submitted };
}
