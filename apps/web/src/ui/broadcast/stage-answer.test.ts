import { assert, setupRitewayBun, test } from 'riteway/bun';
import { drawableStageAnswer } from './stage-answer';

setupRitewayBun();

const rest = { seats: [], debaterIdentities: [], nowMs: 0, room: null };
const drawn = (answer: unknown) => drawableStageAnswer(answer) !== null;

test('the frame draws only an answer that carries what its phase shows', () => {
  assert({
    given: 'each phase whole, and answers of an older or broken shape',
    should: 'draw the whole ones and treat the others as no answer',
    actual: [
      drawn({
        ...rest,
        phase: 'speech',
        clock: { label: 'Constructive', endsAt: '2026-11-02T00:01:00.000Z' },
      }),
      drawn({ ...rest, phase: 'prep', remainingMs: 60_000 }),
      drawn({
        ...rest,
        phase: 'between',
        remainingMs: null,
        next: { label: 'R' },
      }),
      drawn({ ...rest, phase: 'ended' }),
      drawn({ ...rest, phase: 'judging' }),
      drawn({ ...rest, phase: 'slate' }),
      drawn({ ...rest, phase: 'speech', clock: null }),
      drawn({ ...rest, phase: 'prep', clock: null }),
      drawn({ ...rest, phase: 'between', clock: null }),
      drawn({ ...rest, phase: 'intermission' }),
      drawn({ phase: 'slate' }),
      drawn(null),
    ],
    expected: [
      true,
      true,
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
    ],
  });
});
