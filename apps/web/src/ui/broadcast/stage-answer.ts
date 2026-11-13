import type { StageSnapshot } from '../../features/stage-capture/stage-access';

/** The stage route's answer: the snapshot, the server's instant and the room to join. */
export type StageAnswer = StageSnapshot & {
  /** The server's clock, so the burned-in countdown never reads the browser's. */
  readonly nowMs: number;
  readonly debaterIdentities: readonly string[];
  readonly room: { readonly url: string; readonly token: string } | null;
};

const fieldsOf = (value: unknown): Readonly<Record<string, unknown>> | null =>
  typeof value === 'object' && value !== null
    ? (value as Readonly<Record<string, unknown>>)
    : null;

const isText = (value: unknown) => typeof value === 'string';
/** What is left of a wait, or null for a wait that is not counting down; never absent. */
const isWaitLeft = (value: unknown) =>
  value === null || typeof value === 'number';

/** Whether an answer carries what its own phase shows. */
const showsItsPhase = (answer: Readonly<Record<string, unknown>>) => {
  switch (answer.phase) {
    case 'speech': {
      const clock = fieldsOf(answer.clock);
      return isText(clock?.label) && isText(clock?.endsAt);
    }
    case 'prep':
      return isWaitLeft(answer.remainingMs);
    case 'between':
      return (
        isWaitLeft(answer.remainingMs) && isText(fieldsOf(answer.next)?.label)
      );
    case 'judging':
    case 'slate':
    case 'ended':
      return true;
    default:
      return false;
  }
};

/**
 * An answer the frame can draw, or null. The page and the route deploy apart, so a page
 * may for a moment read an answer of another shape; that is no new answer, and the frame
 * keeps what it shows until the next read, rather than drawing half a phase.
 */
export const drawableStageAnswer = (body: unknown): StageAnswer | null => {
  const answer = fieldsOf(body);
  return answer !== null &&
    showsItsPhase(answer) &&
    Array.isArray(answer.seats) &&
    Array.isArray(answer.debaterIdentities) &&
    typeof answer.nowMs === 'number'
    ? (body as StageAnswer)
    : null;
};
