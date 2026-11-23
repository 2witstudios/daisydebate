import type { CompetitionType } from '@daisy/protocol/round';
import type { ReportReason } from '@daisy/protocol/reports';

/**
 * What the person menu shows, as one value: the menu itself, the challenge
 * view with the mode chosen, or the report view with the reason chosen. A
 * mode or reason exists only in its own view, so leaving one starts the
 * next visit fresh.
 */
export type PersonMenuState =
  | { readonly view: 'menu' }
  | { readonly view: 'challenge'; readonly mode: CompetitionType }
  | { readonly view: 'report'; readonly reason: ReportReason | null };

export type PersonMenuView = PersonMenuState['view'];

export type PersonMenuEvent =
  /** The challenge view, starting ranked when this person takes ranked challenges. */
  | { readonly type: 'challenge'; readonly ranked: boolean }
  | { readonly type: 'mode'; readonly mode: CompetitionType }
  | { readonly type: 'report' }
  | { readonly type: 'reason'; readonly reason: ReportReason }
  /** Back, or a report the server filed. */
  | { readonly type: 'menu' };

export const personMenuStart: PersonMenuState = { view: 'menu' };

/** The menu's one transition: total, and a choice outside its view changes nothing. */
export function personMenuOn(
  state: PersonMenuState,
  event: PersonMenuEvent,
): PersonMenuState {
  switch (event.type) {
    case 'challenge':
      return state.view === 'menu'
        ? { view: 'challenge', mode: event.ranked ? 'ranked' : 'casual' }
        : state;
    case 'report':
      return state.view === 'menu' ? { view: 'report', reason: null } : state;
    case 'mode':
      return state.view === 'challenge' && state.mode !== event.mode
        ? { ...state, mode: event.mode }
        : state;
    case 'reason':
      return state.view === 'report' && state.reason !== event.reason
        ? { ...state, reason: event.reason }
        : state;
    case 'menu':
      return state.view === 'menu' ? state : personMenuStart;
  }
}

/** One open person menu: the views it moves between and the choice in each. */
export function createPersonMenuDriver() {
  const listeners = new Set<() => void>();
  let state = personMenuStart;
  return {
    readSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    send(event: PersonMenuEvent) {
      const next = personMenuOn(state, event);
      if (next === state) return;
      state = next;
      for (const listener of listeners) listener();
    },
    dispose() {
      listeners.clear();
    },
  };
}
