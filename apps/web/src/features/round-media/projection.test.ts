import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { seatGrants } from './projection';
import { rules } from './media-world-seats.test-support';

setupRitewayBun();

const startedAt = '2026-11-02T12:00:00.000Z';
const at = (ms: number) => new Date(Date.parse(startedAt) + ms).toISOString();
const seats = [
  {
    id: 'a'.repeat(24),
    actorId: 'aff',
    role: 'affirmative',
    slot: 0,
    kind: 'human',
    eligible: true,
  },
  {
    id: 'n'.repeat(24),
    actorId: 'neg',
    role: 'negative',
    slot: 0,
    kind: 'human',
    eligible: true,
  },
] as const;

const snapshot = (prepMs: number | null, now: string) =>
  ({
    now,
    finalSegmentEndedAt: null,
    participants: seats,
    withdrawn: [],
    round: {
      id: 'r'.repeat(24),
      status: 'opening',
      currentStage: null,
      startedAt: null,
      completedAt: null,
      outcome: null,
      rules,
      participants: seats,
      checkpoint: {
        version: 1,
        prep_consumed_ms: { affirmative: 0, negative: 0 },
        active_prep: null,
        floor: null,
        incident: { phase: 'none' },
        prep_ended_at: null,
        start_gate: null,
        clock_stops: [],
      },
      segments: [],
      opening: {
        state: { startedAt, draw: null, prepMs, stops: [] },
        seed: null,
      },
    },
  }) as unknown as Parameters<typeof seatGrants>[0];

const publish = (prepMs: number | null, now: string) =>
  seatGrants(snapshot(prepMs, now), seats[0].id, () => 's'.repeat(24)).publish;

describe('pre-round prep media', () => {
  test('a debater publishes nothing during prep', () => {
    assert({
      given: 'an opening Round one minute into a twenty minute prep',
      should: 'close every mic and camera',
      actual: publish(1_200_000, at(60_000)),
      expected: [],
    });
  });

  test('media reopens at the instant prep ends', () => {
    assert({
      given: 'the same Round the instant its prep ends, before any sweep',
      should: 'open the pre-speech camera and microphone again',
      actual: [...publish(1_200_000, at(1_200_000))].sort(),
      expected: ['camera', 'microphone'],
    });
  });
});
