import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  emptyRuntimeCheckpoint,
  isRoundEndState,
  isRoundLifecycle,
  roundStatuses,
  runtimeCheckpointSchema,
  type RoundOutcome,
} from './index';

setupRitewayBun();

const started = '2026-10-12T18:00:00.000Z';
const ended = '2026-10-12T18:30:00.000Z';
const instants = [null, started] as const;
const endings = [null, ended] as const;
const outcomes: readonly (RoundOutcome | null)[] = [null, 'affirmative'];

/** Every way the four lifecycle columns can be filled, as `status/started/ended/outcome`. */
const combinations = roundStatuses.flatMap((status) =>
  instants.flatMap((startedAt) =>
    endings.flatMap((completedAt) =>
      outcomes.map((outcome) => ({ status, startedAt, completedAt, outcome })),
    ),
  ),
);
const named = (round: (typeof combinations)[number]) =>
  [
    round.status,
    round.startedAt === null ? '-' : 'started',
    round.completedAt === null ? '-' : 'ended',
    round.outcome ?? '-',
  ].join('/');

describe('the Round lifecycle contract', () => {
  test('each status holds only the instants and result it can have', () => {
    assert({
      given: 'every combination of status, start, end and outcome',
      should:
        'hold exactly the ones the engine lifecycle and rounds_lifecycle_check hold',
      actual: combinations.filter(isRoundLifecycle).map(named),
      expected: [
        'opening/-/-/-',
        'active/started/-/-',
        'completed/started/ended/-',
        'completed/started/ended/affirmative',
        'abandoned/-/ended/-',
        'abandoned/started/ended/-',
      ],
    });
  });

  test('an ending is the same rule without the start', () => {
    assert({
      given: 'every combination, read for its ending alone',
      should: 'hold an ending exactly when some start makes it a lifecycle',
      actual: combinations.filter(
        (round) =>
          isRoundEndState(round) !==
          instants.some((startedAt) =>
            isRoundLifecycle({ ...round, startedAt }),
          ),
      ),
      expected: [],
    });
  });
});

describe('the runtime checkpoint', () => {
  const prep = { side: 'affirmative', started_at: started } as const;
  const parses = (value: unknown) =>
    runtimeCheckpointSchema.safeParse(value).success;

  test('the lead after prep never runs while prep does', () => {
    assert({
      given:
        'a checkpoint in prep, one in the lead after prep, and one claiming both',
      should: 'accept each alone and refuse both at once',
      actual: [
        parses({ ...emptyRuntimeCheckpoint, active_prep: prep }),
        parses({ ...emptyRuntimeCheckpoint, prep_ended_at: ended }),
        parses({
          ...emptyRuntimeCheckpoint,
          active_prep: prep,
          prep_ended_at: ended,
        }),
      ],
      expected: [true, true, false],
    });
  });
});
