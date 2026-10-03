/**
 * Every Watch control that would change something. There is no backend yet,
 * so each answers on the same page with the sample-action banner. The real
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

const labels: Readonly<Record<InertAction, string>> = {
  follow: 'Follow',
  react: 'React',
  chat: 'Send message',
  report: 'Send report',
  notify: 'Notify me',
  clearHistory: 'Clear history',
  saveVisibility: 'Save visibility',
};

/** The words the banner uses for the action. */
export const actionLabel = (action: InertAction): string => labels[action];
