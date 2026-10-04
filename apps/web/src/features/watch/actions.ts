/**
 * Every Watch control that would change something. There is no backend yet,
 * so none of them does: each renders disabled. The real operations (follow,
 * react, post to chat, report, save visibility) replace these entries and
 * nowhere else.
 */
export type InertAction =
  | 'follow'
  | 'react'
  | 'chat'
  | 'report'
  | 'notify'
  | 'clearHistory'
  | 'saveVisibility';
