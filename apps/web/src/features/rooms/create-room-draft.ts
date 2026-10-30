import type {
  FormatDefinition,
  RoomCatalogChoice,
  RoomConfig,
} from '@daisy/protocol';

export type ResolutionMethod = 'policy' | 'value' | 'strike' | 'custom';

/** The editable draft is independent of Room identity and membership. */
export type CreateRoomDraft = {
  readonly basis: RoomCatalogChoice;
  readonly definition: FormatDefinition;
  readonly config: RoomConfig;
  readonly custom: boolean;
  readonly ranked: boolean;
  readonly resolutionMethod: ResolutionMethod;
  readonly customResolution: string;
};

export function createRoomDraft(choice: RoomCatalogChoice): CreateRoomDraft {
  return {
    basis: choice,
    definition: choice.definition,
    config: choice.preset.config,
    custom: choice.role !== 'standard',
    ranked: false,
    resolutionMethod: choice.preset.config.resolutionDraw.enabled
      ? 'strike'
      : choice.formatId === 'policy'
        ? 'policy'
        : choice.formatId === 'value'
          ? 'value'
          : 'custom',
    customResolution: '',
  };
}

/** An edit is an explicit customization; reverting one value does not opt back into Ranked. */
export function editRoomDraft(
  draft: CreateRoomDraft,
  changes: Partial<
    Pick<CreateRoomDraft, 'definition' | 'config' | 'customResolution'>
  >,
): CreateRoomDraft {
  return { ...draft, ...changes, custom: true, ranked: false };
}

export function selectRoomResolution(
  draft: CreateRoomDraft,
  resolutionMethod: ResolutionMethod,
): CreateRoomDraft {
  if (draft.resolutionMethod === resolutionMethod) return draft;
  return { ...draft, resolutionMethod, custom: true, ranked: false };
}

export function setDraftRanked(
  draft: CreateRoomDraft,
  ranked: boolean,
  eligible: boolean,
): CreateRoomDraft {
  return { ...draft, ranked: ranked && eligible && !draft.custom };
}
