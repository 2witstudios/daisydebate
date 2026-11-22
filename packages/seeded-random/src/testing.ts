import fc from 'fast-check';

/**
 * Property tests over generated inputs, on fast-check (ADR 0164). Every run
 * is seeded, so a failure replays exactly; fast-check shrinks it first, so
 * the report names the smallest input it found, not the first.
 */

/** What a property run found: the smallest failing case, or `null` when every case held. */
export type PropertyReport = {
  readonly failure: string | null;
  readonly runs: number;
};

/** A run's seed and size. One fixed seed per suite, so it never varies between runs. */
export type PropertyRun = {
  readonly seed: number;
  readonly runs: number;
};

/**
 * Checks `problems` over `runs` cases of `input`. A case holds when it has
 * no problems; the report carries the shrunk failing case's problems.
 */
export function seededCheck<Input>(
  run: PropertyRun & {
    readonly input: fc.Arbitrary<Input>;
    readonly problems: (input: Input) => readonly string[];
  },
): PropertyReport {
  /** A throw is a problem too, so it shrinks and reports like one. */
  const problemsOf = (input: Input): readonly string[] => {
    try {
      return run.problems(input);
    } catch (error) {
      return [`threw ${String(error)}`];
    }
  };
  const details = fc.check(
    fc.property(run.input, (input) => problemsOf(input).length === 0),
    { seed: run.seed, numRuns: run.runs },
  );
  if (!details.failed) return { failure: null, runs: details.numRuns };
  const counterexample = details.counterexample?.[0];
  const found =
    counterexample === undefined
      ? 'no counterexample'
      : problemsOf(counterexample).join('; ');
  return {
    failure: `seed ${run.seed}, path ${details.counterexamplePath ?? ''}: ${found}`,
    runs: details.numRuns,
  };
}

/** A draw below `limit`, from the walk's generated stream: `0 <= draw(limit) < limit`. */
export type Draw = (limit: number) => number;

/** One step of a walk: the state it reached and what is wrong with it. */
export type WalkStep<State> = {
  readonly state: State;
  readonly problems: readonly string[];
};

/** The draws one step may take; a step that needs more is a mistake in the test. */
const DRAWS_PER_STEP = 12;

const drawsOf = (values: readonly number[]): Draw => {
  let at = 0;
  return (limit) => {
    const value = values[at];
    at += 1;
    if (value === undefined)
      throw new Error(`drew more than the ${values.length} draws on the tape`);
    if (!Number.isInteger(limit) || limit < 1)
      throw new Error(`a walk drew below ${limit}`);
    return value % limit;
  };
};

/**
 * Checks `problems` over `runs` generated cases, each read from a tape of
 * `draws` draws. For an input built by hand from many small choices; the
 * draws shrink towards 0, so a failure reports its simplest choices.
 */
export function seededDraws(
  run: PropertyRun & {
    readonly draws: number;
    readonly problems: (draw: Draw) => readonly string[];
  },
): PropertyReport {
  return seededCheck({
    seed: run.seed,
    runs: run.runs,
    input: fc.array(fc.nat(), { minLength: run.draws, maxLength: run.draws }),
    problems: (tape) => run.problems(drawsOf(tape)),
  });
}

/** Generated draws for async public operations, with the same seed/shrink report. */
export async function seededAsyncDraws(
  run: PropertyRun & {
    readonly draws: number;
    readonly problems: (draw: Draw) => Promise<readonly string[]>;
  },
): Promise<PropertyReport> {
  const problemsOf = async (
    tape: readonly number[],
  ): Promise<readonly string[]> => {
    try {
      return await run.problems(drawsOf(tape));
    } catch (error) {
      return [`threw ${String(error)}`];
    }
  };
  const details = await fc.check(
    fc.asyncProperty(
      fc.array(fc.nat(), { minLength: run.draws, maxLength: run.draws }),
      async (tape) => (await problemsOf(tape)).length === 0,
    ),
    { seed: run.seed, numRuns: run.runs },
  );
  if (!details.failed) return { failure: null, runs: details.numRuns };
  const tape = details.counterexample?.[0];
  const found =
    tape === undefined
      ? 'no counterexample'
      : (await problemsOf(tape)).join('; ');
  return {
    failure: `seed ${run.seed}, path ${details.counterexamplePath ?? ''}: ${found}`,
    runs: details.numRuns,
  };
}

const drawArbitrary = fc.array(fc.nat(), {
  minLength: DRAWS_PER_STEP,
  maxLength: DRAWS_PER_STEP,
});

/**
 * A seeded walk: from `start`, each step picks one of the moves the state
 * allows and takes it. A walk fails at the first step with a problem, and
 * fast-check shrinks it to the shortest walk that still fails, reported as
 * the trace of moves that reached it. Draws shrink towards 0, so a shrunk
 * walk takes the first move offered wherever the choice did not matter.
 */
export function seededWalk<State, Move>(
  walk: PropertyRun & {
    /**
     * Most steps in one walk. Lengths spread evenly from none to this, so
     * `runs` walks take about `runs * steps / 2` steps in all; a walk ends
     * early when no move is offered.
     */
    readonly steps: number;
    readonly start: (draw: Draw) => State;
    /** The moves `state` allows; `draw` may shape them (an id, a delay). */
    readonly moves: (state: State, draw: Draw) => readonly Move[];
    readonly label: (move: Move) => string;
    readonly step: (state: State, move: Move, draw: Draw) => WalkStep<State>;
  },
): PropertyReport {
  return seededCheck({
    seed: walk.seed,
    runs: walk.runs,
    input: fc.tuple(
      drawArbitrary,
      fc.array(drawArbitrary, { maxLength: walk.steps, size: 'max' }),
    ),
    problems: ([start, steps]) => {
      let state = walk.start(drawsOf(start));
      const trace: string[] = [];
      for (const values of steps) {
        const draw = drawsOf(values);
        const moves = walk.moves(state, draw);
        if (moves.length === 0) return [];
        const move = moves[draw(moves.length)]!;
        trace.push(walk.label(move));
        const next = walk.step(state, move, draw);
        if (next.problems.length > 0)
          return [`${next.problems.join('; ')} after ${trace.join(' > ')}`];
        state = next.state;
      }
      return [];
    },
  });
}
