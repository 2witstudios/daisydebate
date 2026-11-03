import type { AudienceReactionKind } from '@daisy/protocol';

export const reactionLabels: Readonly<Record<AudienceReactionKind, string>> = {
  sharp_point: 'Sharp point',
  good_rebuttal: 'Good rebuttal',
  needs_evidence: 'Needs evidence',
  clear_structure: 'Clear structure',
};

/** What a refused reaction, follow or report says. The words are fixed. */
export const audienceRefusalText: Readonly<Record<string, string>> = {
  'reactions-unavailable': 'This Round has no reactions.',
  'reactions-closed': 'Reactions have closed for this Round.',
  'reactions-banned': 'You cannot react to this Round.',
  'reactions-live-room':
    'You are in this Round’s live room, so you cannot react. The audience watches on a delay.',
  'follow-unavailable': 'You cannot follow this debater.',
  'audience-needs-username': 'Choose a username first.',
  'account-restricted':
    'Your account is restricted, so you can read this but not take part.',
};

export const viewerCountText = (viewers: number | null) =>
  viewers === null
    ? null
    : `${viewers} ${viewers === 1 ? 'person' : 'people'} watching`;
