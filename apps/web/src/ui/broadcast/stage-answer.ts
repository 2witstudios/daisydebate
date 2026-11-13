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

/** Whether an answer carries what its own phase shows. */
const showsItsPhase = (answer: Readonly<Record<string, unknown>>) => {
  switch (answer.phase) {
    case 'speech': {
      const clock = fieldsOf(answer.clock);
      return isText(clock?.label) && isText(clock?.endsAt);
    }
    case 'prep':
      return isText(answer.endsAt);
    case 'between':
      return (
        (answer.endsAt === null || isText(answer.endsAt)) &&
        isText(fieldsOf(answer.next)?.label)
      );
    case 'judging':
    case 'slate':
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
