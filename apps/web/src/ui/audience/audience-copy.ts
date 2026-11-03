import type { AudienceReactionKind } from '@daisy/protocol';

export const reactionLabels: Readonly<Record<AudienceReactionKind, string>> = {
  sharp_point: 'Sharp point',
  good_rebuttal: 'Good rebuttal',
  needs_evidence: 'Needs evidence',
  clear_structure: 'Clear structure',
};

export const viewerCountText = (viewers: number | null) =>
  viewers === null
    ? null
    : `${viewers} ${viewers === 1 ? 'person' : 'people'} watching`;
