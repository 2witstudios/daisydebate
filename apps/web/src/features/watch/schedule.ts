/** One speech inside a debate: a turn of the rules' timetable (ADR 0049). */
export type Turn = {
  readonly phaseIndex: number;
  /** Seconds from the start of the debate. */
  readonly startSeconds: number;
  readonly text: string;
};

/** The turns spoken so far, the one in progress last. */
export const spokenTurns = (
  turns: readonly Turn[],
  turnIndex: number,
): readonly Turn[] => turns.slice(0, turnIndex + 1);

/** The full length of a timetable in seconds. */
export const totalSeconds = (
  phases: readonly { readonly seconds: number }[],
): number => phases.reduce((sum, phase) => sum + phase.seconds, 0);
