import type { TournamentView } from './get-tournament';
import { statusOf } from './tournament';

/** What leaving a tournament means at this moment. */
export type WithdrawScreen =
  | { readonly kind: 'not-entered' }
  | { readonly kind: 'leave-waitlist'; readonly position: number }
  | { readonly kind: 'before-bracket' }
  | { readonly kind: 'after-bracket'; readonly opponent: string | null };

/**
 * The withdraw screen for the viewer. Whether the bracket is out comes from
 * the tournament's status; the screen differs because a late withdrawal
 * gives the opponent a bye and is recorded on the tournament log.
 */
export function withdrawScreen(view: TournamentView): WithdrawScreen {
  const { entry, tournament } = view;
  if (entry === null || entry.kind === 'competing')
    return { kind: 'not-entered' };
  if (entry.kind === 'waitlisted')
    return { kind: 'leave-waitlist', position: entry.position };
  const status = statusOf(tournament);
  return status === 'closed' || status === 'live'
    ? { kind: 'after-bracket', opponent: entry.firstOpponent }
    : { kind: 'before-bracket' };
}
