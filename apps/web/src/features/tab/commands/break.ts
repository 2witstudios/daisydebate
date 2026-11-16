import type { BreakCommand } from '@daisy/protocol/lobby/break-command';
import { refuse, type CommandDecision } from './run-command';

export type BreakFacts = {
  readonly eventId: string;
  readonly resultsVersion: number;
  readonly announcedAt: string | null;
  readonly qualification:
    'results-incomplete' | 'break-not-configured' | 'choices-pending' | 'ready';
};
export function decideAnnounceBreak(
  facts: BreakFacts,
  command: BreakCommand,
): CommandDecision<
  | 'not-found'
  | 'results-incomplete'
  | 'break-not-configured'
  | 'choices-pending'
  | 'already-announced',
  never
> {
  if (facts.eventId !== command.eventId) return refuse('not-found');
  if (facts.announcedAt !== null) return refuse('already-announced');
  if (facts.qualification !== 'ready') return refuse(facts.qualification);
  return {
    kind: 'accepted',
    aggregate: { kind: 'event', id: facts.eventId },
    resultingVersion: facts.resultsVersion,
    writes: [],
    findings: [],
    fixtureChanges: [],
  };
}
