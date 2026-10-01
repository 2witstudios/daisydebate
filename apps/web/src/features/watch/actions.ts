/**
 * Every Watch control that would change something. There is no backend yet,
 * so none of them does: each is an inert control that says why. The real
 * operations (follow, react, post to chat, report, save visibility) replace
 * these entries and nowhere else.
 */
export type InertAction =
  | 'follow'
  | 'react'
  | 'chat'
  | 'report'
  | 'notify'
  | 'clearHistory'
  | 'saveVisibility';

const reasons: Readonly<Record<InertAction, string>> = {
  follow: 'Following is not available in this preview.',
  react: 'Reactions are not available in this preview.',
  chat: 'Chat is not available in this preview.',
  report: 'Sending reports is not available in this preview.',
  notify: 'Notifications are not available in this preview.',
  clearHistory: 'Clearing history is not available in this preview.',
  saveVisibility: 'Saving visibility is not available in this preview.',
};

/** Why the action does nothing yet; shown with the disabled control. */
export const inertReason = (action: InertAction): string => reasons[action];
